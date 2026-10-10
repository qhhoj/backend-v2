import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';
import type { LeaderboardRow } from '../leaderboards.repository';

export class LeaderboardEntryResponse {
  /** Position on the board; users with equal values share a rank. */
  rank!: number;
  /** User id. */
  id!: string;
  /** Login name. */
  username!: string;
  /** Name to show: the staff-set override, else the username. */
  displayName!: string;
  /** Rank title such as `user`, `admin` or `banned`. */
  displayRank!: string;
  /** Total points earned from solved problems. */
  points!: number;
  /** Performance points (weighted best solves). */
  performancePoints!: number;
  /** Number of fully solved problems. */
  problemCount!: number;
  /** Contest rating; null while unrated. */
  rating!: number | null;
  /** Points earned from community contributions. */
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
  /** 1-based position of the user. */
  rank!: number;
  /** Leaderboard page that contains the user. */
  page!: number;
  /** Entries per leaderboard page. */
  pageSize!: number;
}
