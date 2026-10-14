import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestViewerService } from '../../contests/core/contest-viewer.service';
import { ContestsRepository } from '../../contests/core/contests.repository';
import type { ContestDocument } from '../../contests/core/contests.repository';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ContestScope } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import {
  SubmissionDetailResponse,
  SubmissionSourceResponse,
} from './dto/submission-detail.response';
import type { SubmissionListQueryDto } from './dto/submission-list.dto';
import { SubmissionListItemResponse } from './dto/submission-list.response';
import {
  caseVisibility,
  detailAccess,
  listCaseUnit,
  shownError,
  staffOnlyFilter,
  submissionActions,
} from './submission-access';
import type {
  CaseVisibility,
  DetailAccess,
  ListCaseUnit,
  SubmissionActions,
} from './submission-access';
import { sourceFilename } from './source-file';
import { TEST_SUMMARY_CAP, testSummaryOf } from './test-summary';
import type { TestSummary } from './test-summary';
import type { SourceFile } from './source-file';
import { ExternalRunsRepository } from './external-runs.repository';
import { SubmissionsRepository } from './submissions.repository';
import type { SubmissionDocument } from './submissions.repository';

/** `result` and `status` only feed `$in`, so they stay plain strings. */
export type SubmissionFilters = Pick<
  SubmissionListQueryDto,
  'user' | 'problem' | 'language'
> & { result?: readonly string[]; status?: readonly string[] };

/** What a list is narrowed to beyond the viewer's filters: one contest's submissions, or those of a set of users (an organization's members). */
export interface ListScope {
  contestId?: string;
  userIds?: readonly string[];
}

const STAFF_ONLY_MESSAGE = 'Only staff can filter by IE, QU, P, G, D or SC.';

/** What a deleted problem's submission shows of its cases: nothing. */
const NO_CASE_DETAIL: CaseVisibility = {
  cases: 'none',
  feedback: false,
  output: false,
};

/** `$in` clauses for the filters that match stored values directly. */
const valueClauses = (
  filters: SubmissionFilters,
): FilterQuery<Submission>[] => [
  ...(filters.language?.length
    ? [{ language: { $in: filters.language } }]
    : []),
  ...(filters.result?.length ? [{ result: { $in: filters.result } }] : []),
  ...(filters.status?.length ? [{ status: { $in: filters.status } }] : []),
];

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly submissions: SubmissionsRepository,
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
    private readonly languages: LanguagesQuerier,
    private readonly currentContest: CurrentContestService,
    private readonly viewers: ContestViewerService,
    private readonly contests: ContestsRepository,
    private readonly externalRuns: ExternalRunsRepository,
  ) {}

  /** The viewer's current contest, resolved once per request and passed to `visible`, `viewable` and `filterFor`. */
  viewerScope(principal: Principal | null): Promise<ContestScope | null> {
    return this.currentContest.scopeOf(principal);
  }

  /** Legacy `SubmissionsListBase`: only submissions on problems the viewer can see; with `scope.contestId`, only that contest's submissions, on any of its problems (legacy `ForceContestMixin` skips the problem filter, the contest's access check stands in for it); with `scope.userIds`, only those users' submissions, under the same visibility rules. */
  async list(
    principal: Principal | null,
    query: SubmissionListQueryDto,
    scope: ListScope = {},
  ): Promise<Paginated<SubmissionListItemResponse>> {
    const staffOnly = staffOnlyFilter(principal, query);
    if (staffOnly)
      throw new AppError('validation_failed', 400, STAFF_ONLY_MESSAGE, {
        [staffOnly]: [STAFF_ONLY_MESSAGE],
      });
    const meta = { page: query.page, pageSize: query.pageSize };
    const filter = await this.filterFor(
      principal,
      query,
      scope.contestId === undefined ? await this.viewerScope(principal) : null,
      scope,
    );
    if (!filter) return new Paginated([], { ...meta, total: 0 });
    const { items, total } = await this.submissions.list(
      filter,
      query.page,
      query.pageSize,
    );
    return new Paginated(await this.listItems(items, principal), {
      ...meta,
      total,
    });
  }

  /** List rows with their user, problem (deleted ones too) and language resolved in one read each; with a `viewer`, each row also carries the test summary that viewer may see (see `listCaseUnit`). */
  async listItems(
    items: readonly Submission[],
    viewer: Principal | null = null,
  ): Promise<SubmissionListItemResponse[]> {
    const [users, problems] = await Promise.all([
      this.users.findByIds(
        unique(items.map((submission) => uuidStr(submission.user))),
      ),
      this.problems.findSummariesIncludingDeleted(
        unique(items.map((submission) => uuidStr(submission.problem))),
      ),
    ]);
    const userOf = new Map(users.map((user) => [user._id, user]));
    const problemOf = new Map(
      problems.map((problem) => [problem._id, problem]),
    );
    const summaries = viewer
      ? await this.testSummaries(viewer, items, problemOf)
      : new Map<string, TestSummary>();
    return items.map((submission) =>
      SubmissionListItemResponse.from(
        submission,
        {
          user: userOf.get(uuidStr(submission.user)),
          problem: problemOf.get(uuidStr(submission.problem)),
          language: this.languages.byId(uuidStr(submission.language)),
        },
        summaries.get(uuidStr(submission._id)) ?? null,
      ),
    );
  }

  /** The rows' test summaries, keyed by submission id: cases are read only for rows whose unit is not null. */
  private async testSummaries(
    viewer: Principal,
    items: readonly Submission[],
    problemOf: ReadonlyMap<string, ProblemDocument>,
  ): Promise<Map<string, TestSummary>> {
    const units = new Map<string, { unit: ListCaseUnit; problemId: string }>();
    for (const submission of items) {
      const problemId = uuidStr(submission.problem);
      const problem = problemOf.get(problemId);
      const unit = problem && this.listCaseUnitOf(viewer, submission, problem);
      if (unit) units.set(uuidStr(submission._id), { unit, problemId });
    }
    const caseProblems = unique(
      [...units.values()]
        .filter(({ unit }) => unit === 'case')
        .map(({ problemId }) => problemId),
    );
    const [heads, caseCounts] = await Promise.all([
      this.submissions.caseHeads([...units.keys()], TEST_SUMMARY_CAP),
      this.problems.caseCounts(caseProblems),
    ]);
    const summaries = new Map<string, TestSummary>();
    for (const [id, { unit, problemId }] of units) {
      const read = heads.get(id) ?? { head: [], count: 0 };
      summaries.set(
        id,
        testSummaryOf(
          unit,
          read.head,
          read.count,
          caseCounts.get(problemId) ?? null,
        ),
      );
    }
    return summaries;
  }

  private listCaseUnitOf(
    viewer: Principal,
    submission: Submission,
    problem: ProblemDocument,
  ): ListCaseUnit | null {
    const view = ProblemAccess.accessView(problem);
    return listCaseUnit(viewer, {
      ownerId: uuidStr(submission.user),
      inContest: submission.contest != null,
      problem: {
        ...view,
        submissionSourceVisibility: problem.submissionSourceVisibility,
        testcaseResultVisibility: problem.testcaseResultVisibility,
        testcaseVisibility: problem.testcaseVisibility,
        allowViewFeedback: problem.allowViewFeedback,
        isDeleted: problem.deletedAt != null,
      },
      canEdit: ProblemAccess.canEdit(viewer, view),
    });
  }

  async detail(
    principal: Principal,
    id: string,
  ): Promise<SubmissionDetailResponse> {
    const scope = await this.viewerScope(principal);
    const viewed = await this.viewable(principal, id, scope);
    const { problem, canEdit } = viewed;
    const visibility = problem.deletedAt
      ? NO_CASE_DETAIL
      : caseVisibility(principal, problem, {
          canEdit,
          isInContest: scope !== null,
        });
    // Cases (up to 10000 rows) are loaded only for a viewer who passed the access check and sees them.
    const submission =
      visibility.cases === 'none'
        ? viewed.submission
        : ((await this.submissions.findById(id, { withCases: true })) ??
          viewed.submission);
    const totalCases =
      visibility.cases === 'none'
        ? null
        : await this.problems.caseCount(problem._id);
    const [owner] = await this.users.findByIds([uuidStr(submission.user)]);
    const actions = this.actionsFor(principal, submission, canEdit);
    return SubmissionDetailResponse.withDetails(
      submission,
      {
        user: owner,
        problem,
        language: this.languages.byId(uuidStr(submission.language)),
      },
      {
        visibility,
        error: shownError(submission, canEdit),
        totalCases,
        lockedAfter: canEdit ? submission.lockedAfter : null,
        actions,
        externalRun: actions.canRejudge
          ? await this.externalRuns.current(
              uuidStr(submission._id),
              submission.judgeGeneration,
            )
          : null,
      },
    );
  }

  /** The viewer's action flags, from the rules the action endpoints check. */
  private actionsFor(
    principal: Principal,
    submission: SubmissionDocument,
    canEditProblem: boolean,
  ): SubmissionActions {
    return submissionActions(principal, {
      isOwner: uuidStr(submission.user) === principal.userId,
      status: submission.status,
      rejudgedDate: submission.rejudgedDate,
      lockedAfter: submission.lockedAfter,
      canEditProblem,
    });
  }

  /** The detail rules for a live stream, and whether case progress may be shown (every case result visible). */
  async streamAccess(
    principal: Principal,
    id: string,
  ): Promise<{ submission: SubmissionDocument; caseEvents: boolean }> {
    const scope = await this.viewerScope(principal);
    const { submission, problem, canEdit } = await this.viewable(
      principal,
      id,
      scope,
    );
    return {
      submission,
      caseEvents:
        !problem.deletedAt &&
        caseVisibility(principal, problem, {
          canEdit,
          isInContest: scope !== null,
        }).cases === 'all',
    };
  }

  /** `filename` is what the raw and download links name the file; null for a file-only language, whose `source` is a URL rather than text. */
  async source(
    principal: Principal,
    id: string,
  ): Promise<SubmissionSourceResponse> {
    const { submission } = await this.viewable(
      principal,
      id,
      await this.viewerScope(principal),
    );
    const language = this.languages.byId(uuidStr(submission.language));
    const submissionId = uuidStr(submission._id);
    return {
      id: submissionId,
      source: (await this.submissions.findSource(submission._id)) ?? '',
      filename: language?.fileOnly
        ? null
        : sourceFilename(submissionId, language?.extension),
    };
  }

  /** `source` as a file: same access rules and errors; 404 for a file-only language, which has no source text. */
  async sourceFile(principal: Principal, id: string): Promise<SourceFile> {
    const { filename, source } = await this.source(principal, id);
    if (filename === null)
      throw new AppError(
        'not_found',
        404,
        'This submission has no source text',
      );
    return { filename, text: source };
  }

  /** 404 for an unknown or malformed id or a problem the viewer cannot see, whoever owns the submission; a deleted problem's history is the exception for the owner and for `judge.view_all_submission`. */
  async visible(
    principal: Principal,
    id: string,
    scope: ContestScope | null,
  ): Promise<{ submission: SubmissionDocument; problem: ProblemDocument }> {
    const submission = await this.submissions.findById(id);
    const problem =
      submission &&
      (await this.problems.findIncludingDeleted(uuidStr(submission.problem)));
    if (
      !submission ||
      !problem ||
      !this.mayRead(principal, submission, problem, scope)
    )
      throw new AppError('not_found', 404, 'No such submission');
    return { submission, problem };
  }

  /** A live problem must be visible to the viewer (source visibility A never exposes a private problem); a deleted or tombstoned one keeps its history for the submission's owner and for staff who see every submission. */
  private mayRead(
    principal: Principal,
    submission: SubmissionDocument,
    problem: ProblemDocument,
    scope: ContestScope | null,
  ): boolean {
    if (problem.deletedAt)
      return (
        uuidStr(submission.user) === principal.userId ||
        hasPermission(principal, 'judge.view_all_submission')
      );
    return ProblemAccess.canSee(
      principal,
      ProblemAccess.accessView(problem),
      scope,
    );
  }

  /** `visible`, then 403 unless legacy `can_see_detail` lets the viewer in; another user's contest submission also needs the contest's full submission list (never during a freeze), unless the viewer edits the contest or the problem or sees every submission. `contest_running` means the contest's list is not open to the viewer yet: running, frozen, or an ended contest whose scoreboard stays hidden. */
  async viewable(
    principal: Principal,
    id: string,
    scope: ContestScope | null,
  ): Promise<{
    submission: SubmissionDocument;
    problem: ProblemDocument;
    canEdit: boolean;
  }> {
    const { submission, problem } = await this.visible(principal, id, scope);
    if (problem.deletedAt) return { submission, problem, canEdit: false };
    const view = ProblemAccess.accessView(problem);
    const canEdit = ProblemAccess.canEdit(principal, view);
    const ownerId = uuidStr(submission.user);
    const contest = submission.contest
      ? await this.contests.findById(uuidStr(submission.contest))
      : null;
    const isContestEditor =
      contest !== null && this.editsContest(principal, contest);
    const access = detailAccess(principal, {
      ownerId,
      problem: {
        ...view,
        submissionSourceVisibility: problem.submissionSourceVisibility,
      },
      canEdit,
      isContestEditor,
    });
    // Solving would not help while the contest list is closed, so that reason wins over `solve_first`; a denied viewer hears `hidden` either way.
    if (
      access !== 'denied' &&
      (await this.isContestListClosed(principal, {
        contest,
        ownerId,
        canEdit,
        isContestEditor,
      }))
    )
      throw new AppError(
        'contest_running',
        403,
        'You cannot see this submission yet',
      );
    await this.assertDetailAllowed(principal, access, problem);
    return { submission, problem, canEdit };
  }

  private editsContest(
    principal: Principal,
    contest: ContestDocument,
  ): boolean {
    return (
      ContestAccess.isEditor(principal, ContestAccess.accessView(contest)) ||
      hasPermission(principal, 'judge.edit_all_contest')
    );
  }

  /** Another user's contest submission stays closed until the contest's full list is open to this viewer. */
  private async isContestListClosed(
    principal: Principal,
    {
      contest,
      ownerId,
      canEdit,
      isContestEditor,
    }: {
      contest: ContestDocument | null;
      ownerId: string;
      canEdit: boolean;
      isContestEditor: boolean;
    },
  ): Promise<boolean> {
    if (
      contest === null ||
      ownerId === principal.userId ||
      canEdit ||
      isContestEditor ||
      hasPermission(principal, 'judge.view_all_submission')
    )
      return false;
    const now = new Date();
    return !ContestAccess.canSeeFullSubmissionList(
      principal,
      ContestAccess.accessView(contest),
      now,
      await this.viewers.viewerOf(principal, contest, now),
    );
  }

  private async assertDetailAllowed(
    principal: Principal,
    access: DetailAccess,
    problem: ProblemDocument,
  ): Promise<void> {
    if (access === 'granted') return;
    if (access === 'denied')
      throw new AppError('hidden', 403, 'You cannot see this submission');
    if (
      !(await this.submissions.hasSolved(
        principal.userId,
        problem._id,
        problem.points,
      ))
    )
      throw new AppError(
        'solve_first',
        403,
        'Solve this problem to see this submission',
      );
  }

  /** Null when nothing can match (unknown user, invisible problem); other users' submissions of contests whose list the viewer may not see (a freeze, which outlives the contest) are left out (legacy `get_visible_problems`). */
  async filterFor(
    principal: Principal | null,
    filters: SubmissionFilters,
    scope: ContestScope | null,
    { contestId, userIds }: ListScope = {},
  ): Promise<FilterQuery<Submission> | null> {
    const problemClauses = await this.problemClauses(
      principal,
      filters.problem,
      scope,
      contestId,
    );
    if (!problemClauses) return null;
    const userClauses = await this.userClauses(filters.user);
    if (!userClauses) return null;
    const clauses: FilterQuery<Submission>[] = [
      ...(contestId === undefined ? [] : [{ contest: contestId }]),
      ...(userIds === undefined ? [] : [{ user: { $in: userIds } }]),
      ...problemClauses,
      ...userClauses,
      ...valueClauses(filters),
      ...(await this.hiddenContestClauses(principal)),
    ];
    return clauses.length ? { $and: clauses } : {};
  }

  /** The named problem (null when unknown or, outside a contest, invisible), else outside a contest the viewer's visible problems. */
  private async problemClauses(
    principal: Principal | null,
    problemCode: string | undefined,
    scope: ContestScope | null,
    contestId: string | undefined,
  ): Promise<FilterQuery<Submission>[] | null> {
    if (problemCode === undefined)
      return contestId === undefined
        ? this.visibleProblemClauses(principal, scope)
        : [];
    const problem = PROBLEM_CODE_PATTERN.test(problemCode)
      ? await this.problems.findByCode(problemCode)
      : null;
    if (!problem) return null;
    if (
      contestId === undefined &&
      !ProblemAccess.canSee(principal, ProblemAccess.accessView(problem), scope)
    )
      return null;
    return [{ problem: problem._id }];
  }

  /** The viewer's visible live problems, plus the history of deleted problems they may read (their own submissions, or every one for `judge.view_all_submission`). A viewer who sees every live problem still must not see deleted ones that are not theirs. */
  private async visibleProblemClauses(
    principal: Principal | null,
    scope: ContestScope | null,
  ): Promise<FilterQuery<Submission>[]> {
    const deleted = await this.problems.deletedIds();
    const visible = ProblemAccess.visibleFilter(principal, scope);
    const live: FilterQuery<Submission> | null = Object.keys(visible).length
      ? { problem: { $in: await this.problems.visibleIds(visible) } }
      : deleted.length
        ? { problem: { $nin: deleted } }
        : null;
    if (!live) return [];
    const history = this.deletedHistoryClause(principal, deleted);
    return [history ? { $or: [live, history] } : live];
  }

  private deletedHistoryClause(
    principal: Principal | null,
    deleted: readonly string[],
  ): FilterQuery<Submission> | null {
    if (!principal || !deleted.length) return null;
    return hasPermission(principal, 'judge.view_all_submission')
      ? { problem: { $in: deleted } }
      : { problem: { $in: deleted }, user: principal.userId };
  }

  private async userClauses(
    username: string | undefined,
  ): Promise<FilterQuery<Submission>[] | null> {
    if (username === undefined) return [];
    const user = await this.users.findByUsername(username);
    return user ? [{ user: user._id }] : null;
  }

  /** One submission against `hiddenContestClauses`: whether the lists leave it out for this viewer because of its contest (problem visibility is the caller's). */
  async hiddenByContest(
    principal: Principal | null,
    { contestId, userId }: { contestId: string | null; userId: string },
  ): Promise<boolean> {
    if (contestId === null || userId === principal?.userId) return false;
    const hidden = await this.viewers.hiddenSubmissionContests(
      principal,
      new Date(),
      [contestId],
    );
    return hidden.length > 0;
  }

  /** Other users' submissions of contests whose list the viewer may not see; the viewer's own stay. */
  private async hiddenContestClauses(
    principal: Principal | null,
  ): Promise<FilterQuery<Submission>[]> {
    const hidden = await this.viewers.hiddenSubmissionContests(
      principal,
      new Date(),
    );
    if (!hidden.length) return [];
    const outsideHidden = { contest: { $nin: hidden } };
    return [
      principal
        ? { $or: [outsideHidden, { user: principal.userId }] }
        : outsideHidden,
    ];
  }
}
