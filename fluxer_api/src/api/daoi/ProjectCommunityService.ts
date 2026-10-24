// SPDX-License-Identifier: AGPL-3.0-or-later

import type {GuildID, UserID} from '@app/api/BrandedTypes';
import type {ProjectCommunityRepository, ProjectCommunityRow} from '@app/api/daoi/ProjectCommunityRepository';

export interface DaoIProject {
	key: string;
	creator: string;
	name: string;
}

export class ProjectCommunityError extends Error {
	constructor(readonly status: 409 | 410 | 502, readonly code: string, message: string) {
		super(message);
	}
}

interface Dependencies {
	bindings: Pick<ProjectCommunityRepository, 'find' | 'reserve' | 'save'>;
	allocateGuildId(): Promise<GuildID>;
	findGuild(id: GuildID): Promise<{ownerId: UserID} | null>;
	createGuild(binding: ProjectCommunityRow, project: DaoIProject): Promise<void>;
	prepareChannels(binding: ProjectCommunityRow): Promise<void>;
	createInvite(binding: ProjectCommunityRow): Promise<string>;
	join(binding: ProjectCommunityRow): Promise<void>;
}

// The controller holds the existing distributed cache lock. The reservation is
// durable before any guild write, so a crashed attempt resumes the same guild.
export class ProjectCommunityService {
	constructor(private readonly deps: Dependencies) {}

	async enter(params: {project: DaoIProject; userId: UserID; walletAddress: string | null}) {
		const {project, userId, walletAddress} = params;
		let binding = await this.deps.bindings.find(project.key);
		if (!binding) {
			if (walletAddress !== project.creator) throw notOpen();
			const reserved: ProjectCommunityRow = {
				project_key: project.key,
				guild_id: await this.deps.allocateGuildId(),
				owner_id: userId,
				discussion_id: null, announcement_id: null, voice_id: null, invite_code: null,
				ready: false, created_at: new Date(),
			};
			binding = await this.deps.bindings.reserve(reserved)
				? reserved
				: await this.deps.bindings.find(project.key);
			if (!binding) throw new Error('Project community reservation was not persisted');
		}
		const guild = await this.deps.findGuild(binding.guild_id);
		if (!binding.ready) {
			if (binding.owner_id !== userId || walletAddress !== project.creator) throw notOpen();
			if (guild && guild.ownerId !== binding.owner_id) {
				throw new ProjectCommunityError(409, 'DAOI_COMMUNITY_OWNER_MISMATCH', '社区归属需要创建者处理。');
			}
			if (!guild) await this.deps.createGuild(binding, project);
			await this.deps.prepareChannels(binding);
			if (!binding.invite_code) binding.invite_code = await this.deps.createInvite(binding);
			binding.ready = true;
			await this.deps.bindings.save(binding);
		} else if (!guild) {
			throw new ProjectCommunityError(410, 'DAOI_COMMUNITY_REMOVED', '项目社区已被删除。');
		}
		await this.deps.join(binding);
		return {guild_id: binding.guild_id.toString(), channel_id: binding.discussion_id!.toString()};
	}
}

function notOpen(): ProjectCommunityError {
	return new ProjectCommunityError(409, 'DAOI_COMMUNITY_NOT_OPEN', '项目创建者尚未开通社区。');
}
