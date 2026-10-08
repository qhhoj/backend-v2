import { ApiProperty } from '@nestjs/swagger';
import type { UserDocument } from '@libs/auth';
import { participationEnd, problemLabel } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type {
  Contest,
  ContestParticipation,
  LabelStyle,
  ScoreboardVisibility,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';
import { ContestListItemResponse } from './contest-list.response';

export class ContestProblemResponse {
  problemId!: string;
  code!: string;
  name!: string;
  label!: string;
  points!: number;
  partial!: boolean;
  isPretested!: boolean;
  maxSubmissions!: number | null;
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

export class ContestViewerResponse {
  canEdit!: boolean;
  isEditor!: boolean;
  isTester!: boolean;
  inContest!: boolean;
  liveParticipation!: ParticipationSummaryResponse | null;
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

  static from(contest: Contest): ContestSettingsResponse {
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
    };
  }
}

export class ContestDetailResponse extends ContestListItemResponse {
  description!: string;
  descriptionHtml!: string;
  authors!: UserSummaryResponse[];
  registrationStart!: Date | null;
  registrationEnd!: Date | null;
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
  disallowVirtual!: boolean;
  requiresAccessCode!: boolean;
  /** Null until the viewer may see them (in the contest, ended, editor or tester). */
  problems!: ContestProblemResponse[] | null;
  viewer!: ContestViewerResponse;
  settings!: ContestSettingsResponse | null;

  static fromDetail(
    contest: Contest,
    extras: {
      now: Date;
      authors: UserDocument[];
      problems: Array<{ _id: string; code: string; name: string }> | null;
      viewer: ContestViewerResponse;
    },
  ): ContestDetailResponse {
    const problemOf = new Map(
      (extras.problems ?? []).map((problem) => [problem._id, problem]),
    );
    return {
      ...ContestListItemResponse.from(contest, extras.now),
      description: contest.description,
      descriptionHtml: contest.descriptionHtml,
      authors: extras.authors.map((author) => UserSummaryResponse.from(author)),
      registrationStart: contest.registrationStart,
      registrationEnd: contest.registrationEnd,
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
      disallowVirtual: contest.disallowVirtual,
      requiresAccessCode: contest.accessCodeHash !== null,
      problems:
        extras.problems &&
        [...contest.problems]
          .sort((left, right) => left.order - right.order)
          .flatMap((entry, index) => {
            const problem = problemOf.get(uuidStr(entry.problem));
            return problem
              ? [
                  {
                    problemId: problem._id,
                    code: problem.code,
                    name: problem.name,
                    label: problemLabel(index, contest.labelStyle),
                    points: entry.points,
                    partial: entry.partial,
                    isPretested: entry.isPretested,
                    maxSubmissions: entry.maxSubmissions,
                  },
                ]
              : [];
          }),
      viewer: extras.viewer,
      settings: extras.viewer.canEdit
        ? ContestSettingsResponse.from(contest)
        : null,
    };
  }
}
