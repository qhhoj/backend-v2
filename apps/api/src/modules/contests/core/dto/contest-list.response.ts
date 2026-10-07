import { contestPhase } from '@libs/contests';
import type { ContestPhase } from '@libs/contests';
import type { Contest, ContestFormatName } from '@libs/database';

export class ContestListItemResponse {
  key!: string;
  name!: string;
  summary!: string;
  startTime!: Date;
  endTime!: Date;
  /** Seconds. */
  timeLimit!: number | null;
  phase!: ContestPhase;
  formatName!: ContestFormatName;
  isRated!: boolean;
  tags!: string[];
  userCount!: number;
  virtualCount!: number;
  isPrivate!: boolean;
  isOrganizationPrivate!: boolean;

  static from(contest: Contest, now: Date): ContestListItemResponse {
    return {
      key: contest.key,
      name: contest.name,
      summary: contest.summary,
      startTime: contest.startTime,
      endTime: contest.endTime,
      timeLimit: contest.timeLimit,
      phase: contestPhase(contest, now),
      formatName: contest.formatName,
      isRated: contest.isRated,
      tags: contest.tags,
      userCount: contest.userCount,
      virtualCount: contest.virtualCount,
      isPrivate: contest.isPrivate,
      isOrganizationPrivate: contest.isOrganizationPrivate,
    };
  }
}
