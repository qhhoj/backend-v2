import { ApiProperty } from '@nestjs/swagger';
import { CONTEST_PHASES, contestPhase, LIVE_STATUSES } from '@libs/contests';
import type { ContestPhase, LiveStatus } from '@libs/contests';
import { CONTEST_FORMAT_NAMES } from '@libs/database';
import type { Contest, ContestFormatName, Organization } from '@libs/database';

/** An organization a contest is restricted to. */
export class ContestOrganizationResponse {
  /** Unique identifier used in the organization's URL. */
  slug!: string;
  name!: string;

  static from(organization: Organization): ContestOrganizationResponse {
    return { slug: organization.slug, name: organization.name };
  }
}

/** What every contest view shows of the contest itself. */
export class ContestSummaryResponse {
  /** Unique short identifier used in URLs. */
  key!: string;
  name!: string;
  /** Short plain-text description for lists. */
  summary!: string;
  /** When the contest starts, ISO 8601. */
  startTime!: Date;
  /** When the contest ends, ISO 8601. */
  endTime!: Date;
  /** Seconds. */
  timeLimit!: number | null;
  /** Where the contest is now relative to its start and end. */
  @ApiProperty({ enum: CONTEST_PHASES, enumName: 'ContestPhase' })
  phase!: ContestPhase;
  /** Scoring format of the contest. */
  @ApiProperty({ enum: CONTEST_FORMAT_NAMES, enumName: 'ContestFormatName' })
  formatName!: ContestFormatName;
  /** Whether finishing the contest changes participants' ratings. */
  isRated!: boolean;
  /** Slugs of the contest's tags. */
  tags!: string[];
  /** Live participants, registrations included. */
  userCount!: number;
  /** Virtual participations. */
  virtualCount!: number;
  /** Only listed contestants may see it. */
  isPrivate!: boolean;
  /** Only members of its organizations may see it. */
  isOrganizationPrivate!: boolean;
  /** The organizations the contest is restricted to, empty unless it is organization-private; unlisted ones show only to viewers who may list them. */
  organizations!: ContestOrganizationResponse[];
  /** Registering and joining (live or virtual) ask for the access code; editors skip it. */
  requiresAccessCode!: boolean;
  /** The public ranking links ask for a ranking access code. */
  requiresRankingAccessCode!: boolean;
  /** Virtual participation after the end is not allowed. */
  disallowVirtual!: boolean;
  /** Both null: the contest takes no registration. */
  registrationStart!: Date | null;
  registrationEnd!: Date | null;

  static from(
    contest: Contest,
    now: Date,
    organizations: ContestOrganizationResponse[],
  ): ContestSummaryResponse {
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
      organizations,
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

/** What only the contest's editors see on a list row. */
export class ContestListEditorResponse {
  /** Whether the contest is shown to users who may see it. */
  isVisible!: boolean;
  /** Live submissions are not rejudged after this time; null for no lock. */
  lockedAfter!: Date | null;
  /** Submissions still waiting for the final judge; null unless the format is `final_submission`. */
  pendingCount!: number | null;
}

export class ContestListItemResponse extends ContestSummaryResponse {
  /** Null for a signed-out visitor. */
  viewer!: ContestListViewerResponse | null;
  /** Null unless the viewer may edit the contest. */
  editor!: ContestListEditorResponse | null;

  static withViewer(
    contest: Contest,
    now: Date,
    extras: {
      viewer: ContestListViewerResponse | null;
      organizations: ContestOrganizationResponse[];
      editor: ContestListEditorResponse | null;
    },
  ): ContestListItemResponse {
    return {
      ...ContestSummaryResponse.from(contest, now, extras.organizations),
      viewer: extras.viewer,
      editor: extras.editor,
    };
  }
}
