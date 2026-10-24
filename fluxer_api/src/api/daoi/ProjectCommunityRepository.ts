// SPDX-License-Identifier: AGPL-3.0-or-later

import type {ChannelID, GuildID, UserID} from '@app/api/BrandedTypes';
import {executeConditional, fetchOne, upsertOne} from '@app/api/database/CassandraQueryExecution';
import {defineTable} from '@app/api/database/CassandraTableDsl';

export interface ProjectCommunityRow {
	project_key: string;
	guild_id: GuildID;
	owner_id: UserID;
	discussion_id: ChannelID | null;
	announcement_id: ChannelID | null;
	voice_id: ChannelID | null;
	invite_code: string | null;
	ready: boolean;
	created_at: Date;
}

const ProjectCommunities = defineTable<ProjectCommunityRow, 'project_key'>({
	name: 'daoi_project_communities',
	columns: [
		'project_key', 'guild_id', 'owner_id', 'discussion_id', 'announcement_id', 'voice_id',
		'invite_code', 'ready', 'created_at',
	],
	primaryKey: ['project_key'],
});

const FIND_PROJECT_COMMUNITY = ProjectCommunities.select({
	where: ProjectCommunities.where.eq('project_key'),
	limit: 1,
});

export class ProjectCommunityRepository {
	find(projectKey: string): Promise<ProjectCommunityRow | null> {
		return fetchOne<ProjectCommunityRow>(FIND_PROJECT_COMMUNITY.bind({project_key: projectKey}));
	}

	reserve(row: ProjectCommunityRow): Promise<boolean> {
		return executeConditional(ProjectCommunities.insertIfNotExists(row));
	}

	async save(row: ProjectCommunityRow): Promise<void> {
		await upsertOne(ProjectCommunities.upsertAll(row));
	}
}
