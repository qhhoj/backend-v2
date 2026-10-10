import { uuidStr } from '@libs/database';
import type { MemberRow } from '../organization-members.repository';

export class MemberResponse {
  /** Rank by the chosen sort; ties share a rank. */
  rank!: number;
  id!: string;
  username!: string;
  /** The name to show: the user's display override, else the username. */
  displayName!: string;
  /** Rank title shown beside the user, such as user or admin. */
  displayRank!: string;
  /** Total problem points. */
  points!: number;
  /** Performance points (weighted best scores). */
  performancePoints!: number;
  /** Problems solved. */
  problemCount!: number;
  /** Contest rating; null while unrated. */
  rating!: number | null;

  static from(row: MemberRow, rank: number): MemberResponse {
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
    };
  }
}
