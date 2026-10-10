import { ApiProperty } from '@nestjs/swagger';
import type { UserDocument } from '@libs/auth';
import { participationEnd, problemLabel } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import { unique } from '@libs/common';
import { LABEL_STYLES, SCOREBOARD_VISIBILITIES, uuidStr } from '@libs/database';
import type {
  Contest,
  ContestParticipation,
  LabelStyle,
  ScoreboardVisibility,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import type { ProblemLimits } from '../contest-problem-limits';
import { ApiProblemCell } from './api-problem-cells';
import {
  ContestListViewerResponse,
  ContestSummaryResponse,
} from './contest-list.response';

/** The viewer's own result on one problem. */
export class ContestProblemViewerResultResponse {
  /** The format's cell (as in `RankingRowResponse.cells`); frozen for non-editors during a freeze; null before a scored submission. */
  @ApiProblemCell()
  cell!: ProblemCell | null;
  /** The cell is worth the problem's full points (the ranking's `acceptedCount` rule). */
  isSolved!: boolean;
  /** Submissions counted against `maxSubmissions` (IE and PD excluded). */
  attempts!: number;
  /** A submission waits for a verdict: queued, judging, or held for final judging. */
  hasPendingSubmission!: boolean;
}

export class ContestProblemResponse {
  /** Id of the problem. */
  problemId!: string;
  /** Problem code. */
  code!: string;
  /** Problem name. */
  name!: string;
  /**
   * The problem's label in this contest, such as A or B, by the contest's
   * label style.
   */
  label!: string;
  /** Points the problem is worth in this contest. */
  points!: number;
  /** Whether partial scores are given. */
  partial!: boolean;
  /** Whether the problem is judged on pretests during the contest. */
  isPretested!: boolean;
  /** Most scored submissions per participant; null means unlimited. */
  maxSubmissions!: number | null;
  /** Seconds; null when the viewer cannot see the problem. */
  timeLimit!: number | null;
  /** KiB; null when the viewer cannot see the problem. */
  memoryLimit!: number | null;
  /** Live participants whose cell is worth the problem's full points (the ranking's `acceptedCount`), frozen for non-editors during a freeze; null unless the viewer may see the full ranking. Up to 30 s old. */
  solverCount!: number | null;
  /** Null when signed out, without a scoring participation (live or virtual) in the contest, or when the board is hidden from the viewer. */
  viewerResult!: ContestProblemViewerResultResponse | null;
}

export class ParticipationSummaryResponse {
  /** Id of the participation. */
  id!: string;
  /** 0 live, -1 spectate, n ≥ 1 virtual. */
  virtual!: number;
  /** True while registered but not yet started. */
  isRegistered!: boolean;
  /** Whether an editor disqualified this participation. */
  isDisqualified!: boolean;
  /** When this participation started, ISO 8601. */
  realStart!: Date;
  /**
   * When this participation ends: the contest end, or the personal time limit
   * if earlier.
   */
  endTime!: Date;
  /** When this participation accepted the contest rules; null when the contest had no rules then (or the row predates rules). */
  @ApiProperty({ type: Date, nullable: true }) rulesAcceptedAt!: Date | null;
  /** The rules revision accepted: it may be older than the contest's current `rulesRevision`. */
  @ApiProperty({ type: Number, nullable: true })
  rulesAcceptedRevision!: number | null;

  static from(
    participation: ContestParticipation,
    contest: Contest,
  ): ParticipationSummaryResponse {
    return {
      id: uuidStr(participation._id),
      virtual: participation.virtual,
      isRegistered: participation.isRegistered,
      isDisqualified: participation.isDisqualified,
      realStart: participation.realStart,
      endTime: participationEnd(contest, participation),
      rulesAcceptedAt: participation.rulesAcceptedAt ?? null,
      rulesAcceptedRevision: participation.rulesAcceptedRevision ?? null,
    };
  }
}

export class ContestViewerResponse extends ContestListViewerResponse {
  /** The viewer may edit the contest. */
  canEdit!: boolean;
  /** The viewer is an author or curator of the contest. */
  isEditor!: boolean;
  /** The viewer is a tester of the contest. */
  isTester!: boolean;
  /**
   * The viewer's current participation is in this contest and has started (or
   * is a spectator).
   */
  inContest!: boolean;
  /** The viewer's live participation, or null if none. */
  liveParticipation!: ParticipationSummaryResponse | null;
  /** The balloon screen is on for this contest and the viewer may use it (editors, listed volunteers). */
  canViewBalloons!: boolean;
}

/** One contest problem's output-prefix override (null: the judge default). */
export class ContestProblemOutputPrefixResponse {
  /** Id of the problem. */
  problemId!: string;
  /** Bytes of output shown for the problem; null uses the judge default. */
  outputPrefixOverride!: number | null;
}

/** Editors only. */
export class ContestSettingsResponse {
  /** Whether the contest is shown to users who may see it. */
  isVisible!: boolean;
  /** Only the listed contestants may see it. */
  isPrivate!: boolean;
  /** Only members of the listed organizations may see it. */
  isOrganizationPrivate!: boolean;
  /** Organization ids tied to the contest. */
  organizations!: string[];
  /** User ids allowed in a private contest. */
  privateContestants!: string[];
  /** User ids with edit rights besides the authors. */
  curators!: string[];
  /** User ids who can see the contest and spectate it before it starts. */
  testers!: string[];
  /** User ids banned from joining. */
  bannedUsers!: string[];
  /** Names of judges that may not judge this contest. */
  bannedJudges!: string[];
  /** User ids who may see the scoreboard whatever its visibility. */
  viewContestScoreboard!: string[];
  /** Live submissions are not rejudged after this time; null for no lock. */
  lockedAfter!: Date | null;
  /** Seconds the ranking is cached; 0 disables the cache. */
  scoreboardCacheTimeout!: number;
  /** Rate every participant, not only those who solved a problem. */
  rateAll!: boolean;
  /** User ids excluded from rating. */
  rateExclude!: string[];
  /** Rating floor applied when rating the contest; null for none. */
  ratingFloor!: number | null;
  /** Rating ceiling applied when rating the contest; null for none. */
  ratingCeiling!: number | null;
  /** Announcements are pushed live and to notification inboxes. */
  pushAnnouncements!: boolean;
  /** On-site balloon deliveries are tracked. */
  balloons!: boolean;
  /** User ids of balloon volunteers. */
  balloonStaff!: string[];
  /**
   * Publish the problems and editorials automatically when the contest ends.
   */
  publishAfterEnd!: boolean;
  /** The editor whose rights the automatic publish re-checks at the end. */
  publishAfterEndBy!: string | null;
  /** Whether a ranking access code is set; the code itself is never returned. */
  hasRankingAccessCode!: boolean;
  problemOutputPrefixes!: ContestProblemOutputPrefixResponse[];
  /** The users named by the id lists above, resolved to usernames. */
  users!: UserSummaryResponse[];

  /** Every user id the settings name, once each. */
  static userIdsOf(contest: Contest): string[] {
    return unique(
      [
        ...contest.privateContestants,
        ...contest.curators,
        ...contest.testers,
        ...contest.bannedUsers,
        ...contest.viewContestScoreboard,
        ...contest.balloonStaff,
        ...contest.rateExclude,
      ].map(uuidStr),
    );
  }

  static from(
    contest: Contest,
    users: readonly UserDocument[],
  ): ContestSettingsResponse {
    const ids = (values: readonly string[]) => values.map(uuidStr);
    return {
      isVisible: contest.isVisible,
      isPrivate: contest.isPrivate,
      isOrganizationPrivate: contest.isOrganizationPrivate,
      organizations: ids(contest.organizations),
      privateContestants: ids(contest.privateContestants),
      curators: ids(contest.curators),
      testers: ids(contest.testers),
      bannedUsers: ids(contest.bannedUsers),
      bannedJudges: contest.bannedJudges,
      viewContestScoreboard: ids(contest.viewContestScoreboard),
      lockedAfter: contest.lockedAfter,
      scoreboardCacheTimeout: contest.scoreboardCacheTimeout,
      rateAll: contest.rateAll,
      rateExclude: ids(contest.rateExclude),
      ratingFloor: contest.ratingFloor,
      ratingCeiling: contest.ratingCeiling,
      pushAnnouncements: contest.pushAnnouncements,
      balloons: contest.balloons,
      balloonStaff: ids(contest.balloonStaff),
      publishAfterEnd: contest.publishAfterEnd,
      publishAfterEndBy:
        contest.publishAfterEndBy === null
          ? null
          : uuidStr(contest.publishAfterEndBy),
      hasRankingAccessCode: contest.rankingAccessCodeHash !== null,
      problemOutputPrefixes: [...contest.problems]
        .sort((left, right) => left.order - right.order)
        .map((entry) => ({
          problemId: uuidStr(entry.problem),
          outputPrefixOverride: entry.outputPrefixOverride,
        })),
      users: users.map((user) => UserSummaryResponse.from(user)),
    };
  }
}

/** What the detail service gathered about the contest's problems. */
export interface ContestProblemFacts {
  summaries: Array<{ _id: string; code: string; name: string }>;
  /** Per problem id; only the problems the viewer may see. */
  limits: Map<string, ProblemLimits>;
  /** Per problem id; null when the viewer has no scoring participation or may not see the board. */
  viewerResults: Map<string, ContestProblemViewerResultResponse> | null;
  /** Per problem id; null when the viewer may not see the full ranking. */
  solverCounts: Map<string, number> | null;
}

/** The contest's problems in order, labelled; an entry whose problem is gone (deleted or not found) is skipped, not an error. */
function labelledProblems(
  contest: Contest,
  facts: ContestProblemFacts,
): ContestProblemResponse[] {
  const summaryOf = new Map(
    facts.summaries.map((summary) => [summary._id, summary]),
  );
  return [...contest.problems]
    .sort((left, right) => left.order - right.order)
    .flatMap((entry, index) => {
      const problemId = uuidStr(entry.problem);
      const summary = summaryOf.get(problemId);
      if (!summary) return [];
      return [
        {
          problemId,
          code: summary.code,
          name: summary.name,
          label: problemLabel(index, contest.labelStyle),
          points: entry.points,
          partial: entry.partial,
          isPretested: entry.isPretested,
          maxSubmissions: entry.maxSubmissions,
          timeLimit: facts.limits.get(problemId)?.timeLimit ?? null,
          memoryLimit: facts.limits.get(problemId)?.memoryLimit ?? null,
          solverCount:
            facts.solverCounts && (facts.solverCounts.get(problemId) ?? 0),
          viewerResult: facts.viewerResults?.get(problemId) ?? null,
        },
      ];
    });
}

export class ContestDetailResponse extends ContestSummaryResponse {
  /** Markdown source of the description. */
  description!: string;
  /** The description rendered to HTML. */
  descriptionHtml!: string;
  /** Markdown rules each participation must accept; empty for none. */
  rules!: string;
  /** The rules rendered to HTML. */
  rulesHtml!: string;
  /** Increases whenever the rules text changes. */
  rulesRevision!: number;
  /** The contest's authors. */
  authors!: UserSummaryResponse[];
  /**
   * Minutes before the end during which the ranking is frozen for non-editors;
   * 0 for no freeze.
   */
  frozenLastMinutes!: number;
  @ApiProperty({
    enum: SCOREBOARD_VISIBILITIES,
    enumName: 'ScoreboardVisibility',
  })
  scoreboardVisibility!: ScoreboardVisibility;
  /**
   * Whether contestants see everyone's submissions while the contest runs.
   */
  showSubmissionList!: boolean;
  /** Decimal places shown in scores. */
  pointsPrecision!: number;
  /** Submissions are judged on pretests only until the contest ends. */
  runPretestsOnly!: boolean;
  /** Hide problem tags from contestants. */
  hideProblemTags!: boolean;
  /** Hide problem authors from contestants. */
  hideProblemAuthors!: boolean;
  /** Show problem points and counts in a compact form. */
  showShortDisplay!: boolean;
  @ApiProperty({ enum: LABEL_STYLES, enumName: 'ContestLabelStyle' })
  labelStyle!: LabelStyle;
  /** Format-specific options, validated by the contest format. */
  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'boolean' }] },
  })
  formatConfig!: Record<string, unknown>;
  /** Null until the viewer may see them (in the contest, ended, editor or tester). */
  problems!: ContestProblemResponse[] | null;
  /** The viewer's own permissions and participation state. */
  viewer!: ContestViewerResponse;
  /** Editor-only settings; null for other viewers. */
  settings!: ContestSettingsResponse | null;

  static fromDetail(
    contest: Contest,
    extras: {
      now: Date;
      authors: UserDocument[];
      problems: ContestProblemFacts | null;
      viewer: ContestViewerResponse;
      settingsUsers: UserDocument[];
    },
  ): ContestDetailResponse {
    return {
      ...ContestSummaryResponse.from(contest, extras.now),
      description: contest.description,
      descriptionHtml: contest.descriptionHtml,
      rules: contest.rules,
      rulesHtml: contest.rulesHtml,
      rulesRevision: contest.rulesRevision,
      authors: extras.authors.map((author) => UserSummaryResponse.from(author)),
      frozenLastMinutes: contest.frozenLastMinutes,
      scoreboardVisibility: contest.scoreboardVisibility,
      showSubmissionList: contest.showSubmissionList,
      pointsPrecision: contest.pointsPrecision,
      runPretestsOnly: contest.runPretestsOnly,
      hideProblemTags: contest.hideProblemTags,
      hideProblemAuthors: contest.hideProblemAuthors,
      showShortDisplay: contest.showShortDisplay,
      labelStyle: contest.labelStyle,
      formatConfig: contest.formatConfig,
      problems: extras.problems && labelledProblems(contest, extras.problems),
      viewer: extras.viewer,
      settings: extras.viewer.canEdit
        ? ContestSettingsResponse.from(contest, extras.settingsUsers)
        : null,
    };
  }
}
