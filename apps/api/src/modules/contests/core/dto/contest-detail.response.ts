import { ApiProperty } from '@nestjs/swagger';
import type { UserDocument } from '@libs/auth';
import { participationEnd, problemLabel } from '@libs/contests';
import type { ProblemCell } from '@libs/contests';
import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type {
  Contest,
  ContestParticipation,
  LabelStyle,
  ScoreboardVisibility,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
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
  problemId!: string;
  code!: string;
  name!: string;
  label!: string;
  points!: number;
  partial!: boolean;
  isPretested!: boolean;
  maxSubmissions!: number | null;
  /** Live participants whose cell is worth the problem's full points (the ranking's `acceptedCount`), frozen for non-editors during a freeze; null unless the viewer may see the full ranking. Up to 30 s old. */
  solverCount!: number | null;
  /** Null when signed out, without a scoring participation (live or virtual) in the contest, or when the board is hidden from the viewer. */
  viewerResult!: ContestProblemViewerResultResponse | null;
}

export class ParticipationSummaryResponse {
  id!: string;
  /** 0 live, -1 spectate, n ≥ 1 virtual. */
  virtual!: number;
  isRegistered!: boolean;
  isDisqualified!: boolean;
  realStart!: Date;
  endTime!: Date;

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
    };
  }
}

export class ContestViewerResponse extends ContestListViewerResponse {
  canEdit!: boolean;
  isEditor!: boolean;
  isTester!: boolean;
  inContest!: boolean;
  liveParticipation!: ParticipationSummaryResponse | null;
}

/** One contest problem's output-prefix override (null: the judge default). */
export class ContestProblemOutputPrefixResponse {
  problemId!: string;
  outputPrefixOverride!: number | null;
}

/** Editors only. */
export class ContestSettingsResponse {
  isVisible!: boolean;
  isPrivate!: boolean;
  isOrganizationPrivate!: boolean;
  organizations!: string[];
  privateContestants!: string[];
  curators!: string[];
  testers!: string[];
  bannedUsers!: string[];
  bannedJudges!: string[];
  viewContestScoreboard!: string[];
  lockedAfter!: Date | null;
  scoreboardCacheTimeout!: number;
  rateAll!: boolean;
  rateExclude!: string[];
  ratingFloor!: number | null;
  ratingCeiling!: number | null;
  pushAnnouncements!: boolean;
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
          solverCount:
            facts.solverCounts && (facts.solverCounts.get(problemId) ?? 0),
          viewerResult: facts.viewerResults?.get(problemId) ?? null,
        },
      ];
    });
}

export class ContestDetailResponse extends ContestSummaryResponse {
  description!: string;
  descriptionHtml!: string;
  authors!: UserSummaryResponse[];
  frozenLastMinutes!: number;
  scoreboardVisibility!: ScoreboardVisibility;
  showSubmissionList!: boolean;
  pointsPrecision!: number;
  runPretestsOnly!: boolean;
  hideProblemTags!: boolean;
  hideProblemAuthors!: boolean;
  showShortDisplay!: boolean;
  labelStyle!: LabelStyle;
  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'number' }, { type: 'boolean' }] },
  })
  formatConfig!: Record<string, unknown>;
  /** Null until the viewer may see them (in the contest, ended, editor or tester). */
  problems!: ContestProblemResponse[] | null;
  viewer!: ContestViewerResponse;
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
