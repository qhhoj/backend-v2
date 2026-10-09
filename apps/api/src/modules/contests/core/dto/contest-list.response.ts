import { ApiProperty } from '@nestjs/swagger';
import { CONTEST_PHASES, contestPhase, LIVE_STATUSES } from '@libs/contests';
import type { ContestPhase, LiveStatus } from '@libs/contests';
import { CONTEST_FORMAT_NAMES } from '@libs/database';
import type { Contest, ContestFormatName } from '@libs/database';

/** What every contest view shows of the contest itself. */
export class ContestSummaryResponse {
  key!: string;
  name!: string;
  summary!: string;
  startTime!: Date;
  endTime!: Date;
  /** Seconds. */
  timeLimit!: number | null;
  @ApiProperty({ enum: CONTEST_PHASES, enumName: 'ContestPhase' })
  phase!: ContestPhase;
  @ApiProperty({ enum: CONTEST_FORMAT_NAMES, enumName: 'ContestFormatName' })
  formatName!: ContestFormatName;
  isRated!: boolean;
  tags!: string[];
  userCount!: number;
  virtualCount!: number;
  isPrivate!: boolean;
  isOrganizationPrivate!: boolean;
  /** Registering and joining (live or virtual) ask for the access code; editors skip it. */
  requiresAccessCode!: boolean;
  /** The public ranking links ask for a ranking access code. */
  requiresRankingAccessCode!: boolean;
  disallowVirtual!: boolean;
  /** Both null: the contest takes no registration. */
  registrationStart!: Date | null;
  registrationEnd!: Date | null;

  static from(contest: Contest, now: Date): ContestSummaryResponse {
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
      requiresAccessCode: contest.accessCodeHash !== null,
      requiresRankingAccessCode: contest.rankingAccessCodeHash !== null,
      disallowVirtual: contest.disallowVirtual,
      registrationStart: contest.registrationStart,
      registrationEnd: contest.registrationEnd,
    };
  }
}

/** The signed-in viewer's own state in one contest. */
export class ContestListViewerResponse {
  /** Their live participation (`liveStatusOf`); null when they have none. */
  @ApiProperty({ enum: [...LIVE_STATUSES], nullable: true, type: String })
  liveStatus!: LiveStatus | null;
  /** Their current contest (`GET /contests/current`) is this one, and that participation has not ended. */
  isCurrent!: boolean;
}

export class ContestListItemResponse extends ContestSummaryResponse {
  /** Null for a signed-out visitor. */
  viewer!: ContestListViewerResponse | null;

  static withViewer(
    contest: Contest,
    now: Date,
    viewer: ContestListViewerResponse | null,
  ): ContestListItemResponse {
    return { ...ContestSummaryResponse.from(contest, now), viewer };
  }
}
