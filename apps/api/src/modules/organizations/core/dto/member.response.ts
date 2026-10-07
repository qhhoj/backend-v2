import { uuidStr } from '@libs/database';
import type { MemberRow } from '../organization-members.repository';

export class MemberResponse {
  rank!: number;
  id!: string;
  username!: string;
  displayName!: string;
  displayRank!: string;
  points!: number;
  performancePoints!: number;
  problemCount!: number;
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
