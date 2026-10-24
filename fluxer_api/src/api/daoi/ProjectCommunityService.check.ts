// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {GuildID, UserID} from '@app/api/BrandedTypes';
import type {ProjectCommunityRow} from './ProjectCommunityRepository';
import {ProjectCommunityError, ProjectCommunityService} from './ProjectCommunityService';

const ownerId = 1n as UserID;
const visitorId = 2n as UserID;
const creator = `0x${'a'.repeat(40)}`;
const project = {key: '56:factory:0', creator, name: 'Project'};

function fixture() {
	const records = new Map<string, ProjectCommunityRow>();
	const guilds = new Map<GuildID, {ownerId: UserID}>();
	let allocated = 0;
	let created = 0;
	let invited = 0;
	let crashAfterGuild = false;
	let banned = false;
	const service = new ProjectCommunityService({
		bindings: {
			find: async (key) => records.has(key) ? structuredClone(records.get(key)!) : null,
			reserve: async (row) => {
				if (records.has(row.project_key)) return false;
				records.set(row.project_key, structuredClone(row));
				return true;
			},
			save: async (row) => {records.set(row.project_key, structuredClone(row));},
		},
		allocateGuildId: async () => BigInt(++allocated + 100) as GuildID,
		findGuild: async (id) => guilds.get(id) ?? null,
		createGuild: async (row) => {created++; guilds.set(row.guild_id, {ownerId: row.owner_id});},
		prepareChannels: async (row) => {
			if (crashAfterGuild) {crashAfterGuild = false; throw new Error('simulated interruption');}
			row.discussion_id = 201n as ProjectCommunityRow['discussion_id'];
			row.announcement_id = 202n as ProjectCommunityRow['announcement_id'];
			row.voice_id = 203n as ProjectCommunityRow['voice_id'];
		},
		createInvite: async () => {invited++; return 'permanent-project-invite';},
		join: async () => {if (banned) throw new Error('BannedFromGuild');},
	});
	return {
		service, records, guilds,
		counts: () => ({allocated, created, invited}),
		interruptNext: () => {crashAfterGuild = true;},
		ban: () => {banned = true;},
	};
}

test('visitor cannot reserve a project before its creator opens it', async () => {
	const f = fixture();
	await assert.rejects(f.service.enter({project, userId: visitorId, walletAddress: null}), (error) =>
		error instanceof ProjectCommunityError && error.status === 409 && error.code === 'DAOI_COMMUNITY_NOT_OPEN');
	assert.equal(f.records.size, 0);
	assert.deepEqual(f.counts(), {allocated: 0, created: 0, invited: 0});
});

test('creator first visit creates once and repeat visits reuse the same community', async () => {
	const f = fixture();
	const first = await f.service.enter({project, userId: ownerId, walletAddress: creator});
	const second = await f.service.enter({project, userId: ownerId, walletAddress: creator});
	assert.deepEqual(second, first);
	assert.deepEqual(f.counts(), {allocated: 1, created: 1, invited: 1});
	assert.equal(f.records.get(project.key)?.owner_id, ownerId);
});

test('an interrupted guild creation resumes its reserved ID without creating another guild', async () => {
	const f = fixture();
	f.interruptNext();
	await assert.rejects(f.service.enter({project, userId: ownerId, walletAddress: creator}), /simulated interruption/);
	assert.equal(f.records.get(project.key)?.ready, false);
	await assert.rejects(f.service.enter({project, userId: visitorId, walletAddress: null}), (error) =>
		error instanceof ProjectCommunityError && error.code === 'DAOI_COMMUNITY_NOT_OPEN');
	const resumed = await f.service.enter({project, userId: ownerId, walletAddress: creator});
	assert.equal(resumed.guild_id, '101');
	assert.deepEqual(f.counts(), {allocated: 1, created: 1, invited: 1});
});

test('ordinary entry keeps invite rejection and does not claim ownership', async () => {
	const f = fixture();
	await f.service.enter({project, userId: ownerId, walletAddress: creator});
	f.ban();
	await assert.rejects(f.service.enter({project, userId: visitorId, walletAddress: null}), /BannedFromGuild/);
	assert.equal(f.records.get(project.key)?.owner_id, ownerId);
	assert.equal(f.counts().created, 1);
});

test('deleting an established community does not silently create a replacement', async () => {
	const f = fixture();
	const result = await f.service.enter({project, userId: ownerId, walletAddress: creator});
	f.guilds.delete(BigInt(result.guild_id) as GuildID);
	await assert.rejects(f.service.enter({project, userId: ownerId, walletAddress: creator}), (error) =>
		error instanceof ProjectCommunityError && error.status === 410);
	assert.equal(f.counts().created, 1);
});
