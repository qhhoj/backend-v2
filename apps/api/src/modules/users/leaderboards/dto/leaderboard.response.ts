import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';
import type { LeaderboardRow } from '../leaderboards.repository';

export class LeaderboardEntryResponse {
  rank!: number;
  id!: string;
  username!: string;
  displayName!: string;
  displayRank!: string;
  points!: number;
  performancePoints!: number;
  problemCount!: number;
  rating!: number | null;
  contributionPoints!: number;
  /** The user's first listed organization, whoever views (legacy prefetched listed ones only). */
  organization!: OrganizationSummaryResponse | null;

  static from(
    row: LeaderboardRow,
    rank: number,
    organization: Organization | null,
  ): LeaderboardEntryResponse {
    return {
      rank,
      id: uuidStr(row._id),
      username: row.username,
      displayName: row.usernameDisplayOverride || row.username,
      displayRank: row.displayRank,
      points: row.points,
      performancePoints: row.performancePoints,
      problemCount: row.problemCount,
      rating: row.rating,
      contributionPoints: row.contributionPoints,
      organization:
        organization && OrganizationSummaryResponse.from(organization),
    };
  }
}

export class RankResponse {
  rank!: number;
  page!: number;
  pageSize!: number;
}
