// SPDX-License-Identifier: AGPL-3.0-or-later

import {requireEmailVerified} from '@app/api/auth/EmailVerificationUtils';
import {SsoIdentityRepository} from '@app/api/auth/services/SsoIdentityRepository';
import {type ChannelID, createChannelID, createGuildID, createInviteCode} from '@app/api/BrandedTypes';
import {Config} from '@app/api/Config';
import {ProjectCommunityRepository} from '@app/api/daoi/ProjectCommunityRepository';
import type {ProjectCommunityRow} from '@app/api/daoi/ProjectCommunityRepository';
import {type DaoIProject, ProjectCommunityError, ProjectCommunityService} from '@app/api/daoi/ProjectCommunityService';
import {viewerFromCtx} from '@app/api/experiment/ChannelThreadsGate';
import {GuildRepository} from '@app/api/guild/repositories/GuildRepository';
import {resolveLimitSafe} from '@app/api/limits/LimitConfigUtils';
import {createLimitMatchContext} from '@app/api/limits/LimitMatchContextBuilder';
import {DefaultUserOnly, LoginRequired} from '@app/api/middleware/AuthMiddleware';
import {RateLimitMiddleware} from '@app/api/middleware/RateLimitMiddleware';
import {OpenAPI} from '@app/api/middleware/ResponseTypeMiddleware';
import {RateLimitConfigs} from '@app/api/RateLimitConfig';
import type {HonoApp, HonoEnv} from '@app/api/types/HonoEnv';
import {assertAccountNotLimited} from '@app/api/user/AccountLimit';
import {Validator} from '@app/api/Validator';
import {AdminACLs} from '@fluxer/constants/src/AdminACLs';
import {ChannelTypes, Permissions} from '@fluxer/constants/src/ChannelConstants';
import {DEFAULT_THREAD_PERMISSIONS} from '@fluxer/constants/src/ThreadPermissionUtils';
import {ResourceLockedError} from '@fluxer/errors/src/domains/core/ResourceLockedError';
import {GuildCreationPermissionRequiredError} from '@fluxer/errors/src/domains/guild/GuildCreationPermissionRequiredError';
import {SingleCommunityCannotCreateGuildsError} from '@fluxer/errors/src/domains/guild/SingleCommunityCannotCreateGuildsError';
import {ChannelCreateRequest, type ChannelUpdateGatedRequest} from '@fluxer/schema/src/domains/channel/ChannelRequestSchemas';
import {SnowflakeType} from '@fluxer/schema/src/primitives/SchemaPrimitives';
import type {Context} from 'hono';
import {z} from 'zod';

const DAOI_ISSUER = 'https://auth.chat.daoi.ai';
const EnterRequest = z.object({
	chain_id: z.number().int().positive(),
	factory_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	project_id: z.string().max(80).regex(/^(?:(?:curve|rwa-presale|rwa-curve):)?\d+$/),
});

export async function fetchDaoIProject(input: z.infer<typeof EnterRequest>): Promise<DaoIProject> {
	const url = new URL(`https://daoi.ai/api/project/${encodeURIComponent(input.project_id)}`);
	url.searchParams.set('chainId', input.chain_id.toString());
	url.searchParams.set('factory', input.factory_address);
	const response = await fetch(url, {signal: AbortSignal.timeout(15000), redirect: 'error'});
	if (!response.ok) throw new ProjectCommunityError(502, 'DAOI_PROJECT_UNAVAILABLE', '暂时无法读取项目，请稍后重试。');
	const project = await response.json() as Record<string, unknown>;
	const onchainId = Number(input.project_id.split(':').at(-1));
	const factory = input.factory_address.toLowerCase();
	if (
		project.mock || Number(project.chainId) !== input.chain_id ||
		String(project.factoryAddress).toLowerCase() !== factory ||
		!Number.isSafeInteger(onchainId) || !Number.isSafeInteger(project.onchainId) || project.onchainId !== onchainId ||
		typeof project.creator !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(project.creator) ||
		/^0x0{40}$/i.test(project.creator)
	) throw new ProjectCommunityError(502, 'DAOI_PROJECT_MISMATCH', '项目归属信息不一致。');
	return {
		key: `${input.chain_id}:${factory}:${onchainId}`,
		creator: project.creator.toLowerCase(),
		name: String(project.name || project.symbol || '').trim().slice(0, 100) || `DAOI 项目 ${input.project_id}`,
	};
}

export function ProjectCommunityController(app: HonoApp): void {
	app.post(
		'/daoi/project-community/enter',
		RateLimitMiddleware(RateLimitConfigs.INVITE_ACCEPT), LoginRequired, DefaultUserOnly,
		Validator('json', EnterRequest),
		OpenAPI({
			operationId: 'enter_daoi_project_community',
			summary: 'Enter DAOI project community',
			description: 'The verified project creator opens the community; other users join through its normal invite.',
			requestSchema: EnterRequest,
			responseSchema: z.object({guild_id: SnowflakeType, channel_id: SnowflakeType}),
			statusCode: 200,
			security: ['sessionToken'],
			tags: ['Guilds'],
		}),
		async (ctx) => {
			assertAccountNotLimited(ctx.get('user'));
			try {
				const project = await fetchDaoIProject(ctx.req.valid('json'));
				const cache = ctx.get('cacheService');
				const lockKey = `daoi:project-community:${project.key}`;
				const token = await cache.acquireLock(lockKey, 120);
				if (!token) throw new ResourceLockedError();
				try {
					const identity = await new SsoIdentityRepository().findByUserId(DAOI_ISSUER, ctx.get('user').id);
					return ctx.json(await serviceFor(ctx).enter({
						project, userId: ctx.get('user').id, walletAddress: identity?.wallet_address ?? null,
					}));
				} finally {
					await cache.releaseLock(lockKey, token);
				}
			} catch (error) {
				if (error instanceof ProjectCommunityError) {
					return ctx.json({code: error.code, message: error.message}, error.status);
				}
				throw error;
			}
		},
	);
}

function serviceFor(ctx: Context<HonoEnv>): ProjectCommunityService {
	const user = ctx.get('user');
	const requestCache = ctx.get('requestCache');
	const viewer = viewerFromCtx(ctx);
	const bindings = new ProjectCommunityRepository();
	const guilds = new GuildRepository(requestCache);
	const channels = ctx.get('channelRepository').channelData;
	const guildService = ctx.get('guildService');
	return new ProjectCommunityService({
		bindings,
		allocateGuildId: async () => createGuildID(await ctx.get('snowflakeService').generate()),
		findGuild: (guildId) => guilds.findUnique(guildId),
		createGuild: async (binding, project) => {
			const policy = await ctx.get('instanceConfigRepository').getInstancePolicyConfig();
			if (policy.single_community_enabled) throw new SingleCommunityCannotCreateGuildsError();
			if (!user.isUnclaimedAccount()) requireEmailVerified(user, 'guild_creation');
			if (Config.instance.selfHosted && !policy.guild_create_access) {
				const granted = user.acls.has(AdminACLs.WILDCARD) || resolveLimitSafe(
					ctx.get('limitConfigService').getConfigSnapshot(), createLimitMatchContext({user}),
					'feature_guild_create', 0,
				) > 0;
				if (!granted) throw new GuildCreationPermissionRequiredError();
			}
			await guildService.data.operations.createGuild({
				user, data: {name: project.name}, locale: ctx.get('requestLocale'), reservedGuildId: binding.guild_id,
			});
		},
		prepareChannels: async (binding) => {
			// A retry after the atomic default guild batch can safely rejoin/start its gateway state.
			await ctx.get('gatewayService').startGuild(binding.guild_id);
			await ctx.get('gatewayService').joinGuild({userId: user.id, guildId: binding.guild_id});
			const guild = await guilds.findUnique(binding.guild_id);
			const list = await channels.listGuildChannels(binding.guild_id, 'enrolled');
			const discussion = binding.discussion_id ?? guild?.systemChannelId;
			if (!discussion) throw new Error('Project guild has no default discussion channel');
			binding.discussion_id = discussion;
			await updateChannel(ctx, discussion, {name: '讨论'});
			const voice = binding.voice_id ?? list.find((channel) => channel.type === ChannelTypes.GUILD_VOICE)?.id;
			if (voice) {
				binding.voice_id = voice;
				await updateChannel(ctx, voice, {name: '语音会议', user_limit: 0});
			} else {
				binding.voice_id = await createChannel(ctx, binding, {type: ChannelTypes.GUILD_VOICE, name: '语音会议', user_limit: 0});
			}
			const announcement = binding.announcement_id ?? list.find((channel) =>
				channel.type === ChannelTypes.GUILD_TEXT && channel.name === '公告')?.id;
			const permissionOverwrites = [{
				id: binding.guild_id.toString(), type: 0 as const, allow: '0',
				deny: (Permissions.SEND_MESSAGES | DEFAULT_THREAD_PERMISSIONS).toString(),
			}];
			if (announcement) {
				binding.announcement_id = announcement;
				await updateChannel(ctx, announcement, {permission_overwrites: permissionOverwrites});
			} else {
				binding.announcement_id = await createChannel(ctx, binding, {
					type: ChannelTypes.GUILD_TEXT, name: '公告', permission_overwrites: permissionOverwrites,
				});
			}
			await bindings.save(binding);
		},
		createInvite: async (binding) => {
			const invite = await ctx.get('inviteRequestService').createChannelInvite({
				inviterId: user.id, viewer, channelId: binding.discussion_id!, requestCache,
				data: {max_age: 0, max_uses: 0, temporary: false},
			});
			return invite.code;
		},
		join: async (binding) => {
			if (!await guilds.getMember(binding.guild_id, user.id)) {
				await ctx.get('inviteRequestService').acceptInvite({
					userId: user.id, inviteCode: createInviteCode(binding.invite_code!), requestCache,
				});
			}
		},
	});
}

async function createChannel(
	ctx: Context<HonoEnv>, binding: ProjectCommunityRow, input: z.input<typeof ChannelCreateRequest>,
) {
	const channel = await ctx.get('guildService').channels.createChannel({
		userId: ctx.get('user').id, guildId: binding.guild_id,
		data: ChannelCreateRequest.parse(input), requestCache: ctx.get('requestCache'),
		clientFeatures: ctx.get('clientFeatures'), viewer: viewerFromCtx(ctx),
	});
	return createChannelID(BigInt(channel.id));
}

async function updateChannel(
	ctx: Context<HonoEnv>, channelId: ChannelID, data: ChannelUpdateGatedRequest,
) {
	await ctx.get('channelRequestService').updateChannel({
		userId: ctx.get('user').id, viewer: viewerFromCtx(ctx), channelId, data,
		clientFeatures: ctx.get('clientFeatures'), requestCache: ctx.get('requestCache'), auditLogReason: null,
	});
}
