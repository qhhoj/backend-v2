import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { contestSubmissionPoints } from '@libs/contests';
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
import type { SubmissionContestResponse } from './dto/submission-detail.response';
import type { SubmissionListQueryDto } from './dto/submission-list.dto';
import { SubmissionListItemResponse } from './dto/submission-list.response';
import {
  caseVisibility,
  detailAccess,
  listCaseUnit,
  shownError,
  sourceAccessOf,
  staffOnlyFilter,
  submissionActions,
} from './submission-access';
import type {
  CaseVisibility,
  DetailAccess,
  ListCaseUnit,
  SourceAccess,
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

/** What the access rules read about a submission the viewer may see (`visible`); a deleted problem has no contest gate and no editors. */
interface SubmissionFacts {
  submission: SubmissionDocument;
  problem: ProblemDocument;
  ownerId: string;
  canEdit: boolean;
  contest: ContestDocument | null;
  isContestEditor: boolean;
}

/** A submission whose result page the viewer may open, with what they may read of its source. */
export interface ReadableSubmission {
  submission: SubmissionDocument;
  problem: ProblemDocument;
  canEdit: boolean;
  source: SourceAccess;
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

  /** The `total` that `list` reports for this scope with no filters, without reading rows (a user page's submission count). */
  async count(principal: Principal | null, scope: ListScope): Promise<number> {
    const filter = await this.filterFor(
      principal,
      {},
      await this.viewerScope(principal),
      scope,
    );
    return filter ? this.submissions.count(filter) : 0;
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

  /** The result page: open to whoever may see the submission (`readable`); feedback, output and the compile log only with source access (a compile log quotes the source). */
  async detail(
    principal: Principal | null,
    id: string,
  ): Promise<SubmissionDetailResponse> {
    const scope = await this.viewerScope(principal);
    const viewed = await this.readable(principal, id, scope);
    const { problem, canEdit } = viewed;
    const readsSource = viewed.source === 'granted';
    const visibility = problem.deletedAt
      ? NO_CASE_DETAIL
      : caseVisibility(principal, problem, {
          canEdit,
          isInContest: scope !== null,
          readsSource,
        });
    const submission = await this.withCasesFor(viewed.submission, visibility);
    const [owner] = await this.users.findByIds([uuidStr(submission.user)]);
    const actions = this.actionsFor(principal, submission, canEdit);
    const [totalCases, externalRun, contest] = await Promise.all([
      visibility.cases === 'none' ? null : this.problems.caseCount(problem._id),
      actions.canRejudge
        ? this.externalRuns.current(
            uuidStr(submission._id),
            submission.judgeGeneration,
          )
        : null,
      this.contestOf(principal, submission, problem),
    ]);
    return SubmissionDetailResponse.withDetails(
      submission,
      {
        user: owner,
        problem,
        language: this.languages.byId(uuidStr(submission.language)),
      },
      {
        visibility,
        error: readsSource ? shownError(submission, canEdit) : null,
        sourceAccess: viewed.source,
        totalCases,
        lockedAfter: canEdit ? submission.lockedAfter : null,
        actions,
        externalRun,
        contest,
      },
    );
  }

  /** The submission's contest and its points there, under the contest's own visibility rule; a deleted problem keeps it too. The points are worked out as the worker stores them (`contestSubmissionPoints`), so a result read right after judging does not race the worker; a problem no longer in the contest keeps its stored points. */
  private async contestOf(
    principal: Principal | null,
    submission: SubmissionDocument,
    problem: ProblemDocument,
  ): Promise<SubmissionContestResponse | null> {
    if (!submission.contest) return null;
    const contest = await this.contests.findById(uuidStr(submission.contest));
    if (
      !contest ||
      !ContestAccess.canSee(principal, ContestAccess.accessView(contest))
    )
      return null;
    const contestProblem = contest.problems.find(
      (entry) => uuidStr(entry.problem) === uuidStr(problem._id),
    );
    const points = contestProblem
      ? contestSubmissionPoints(
          submission,
          contestProblem,
          contest.formatName,
          problem.partial,
        )
      : await this.submissions.contestPoints(uuidStr(submission._id));
    return { key: contest.key, name: contest.name, points };
  }

  /** Cases (up to 10000 rows) are loaded only for a viewer who passed the access check and sees them. */
  private async withCasesFor(
    submission: SubmissionDocument,
    visibility: CaseVisibility,
  ): Promise<SubmissionDocument> {
    if (visibility.cases === 'none') return submission;
    return (
      (await this.submissions.findById(uuidStr(submission._id), {
        withCases: true,
      })) ?? submission
    );
  }

  /** The viewer's action flags, from the rules the action endpoints check. */
  private actionsFor(
    principal: Principal | null,
    submission: SubmissionDocument,
    canEditProblem: boolean,
  ): SubmissionActions {
    return submissionActions(principal, {
      isOwner: uuidStr(submission.user) === principal?.userId,
      status: submission.status,
      rejudgedDate: submission.rejudgedDate,
      lockedAfter: submission.lockedAfter,
      canEditProblem,
    });
  }

  /** The result page's rules for a live stream (the source rule plays no part), and whether case progress may be shown (every case result visible). */
  async streamAccess(
    principal: Principal | null,
    id: string,
  ): Promise<{ submission: SubmissionDocument; caseEvents: boolean }> {
    const scope = await this.viewerScope(principal);
    const facts = await this.factsOf(principal, id, scope);
    await this.assertResultOpen(principal, facts);
    const { submission, problem, canEdit } = facts;
    return {
      submission,
      caseEvents:
        !problem.deletedAt &&
        caseVisibility(principal, problem, {
          canEdit,
          isInContest: scope !== null,
          readsSource: false,
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
    principal: Principal | null,
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
    principal: Principal | null,
    submission: SubmissionDocument,
    problem: ProblemDocument,
    scope: ContestScope | null,
  ): boolean {
    if (problem.deletedAt)
      return (
        principal !== null &&
        (uuidStr(submission.user) === principal.userId ||
          hasPermission(principal, 'judge.view_all_submission'))
      );
    return ProblemAccess.canSee(
      principal,
      ProblemAccess.accessView(problem),
      scope,
    );
  }

  /** `visible`, then the contest gate (`assertResultOpen`); `source` is legacy `can_see_detail` for signed-in viewers and `sign_in` for visitors. The result page's rule. */
  async readable(
    principal: Principal | null,
    id: string,
    scope: ContestScope | null,
  ): Promise<ReadableSubmission> {
    const facts = await this.factsOf(principal, id, scope);
    await this.assertResultOpen(principal, facts);
    const { submission, problem, canEdit } = facts;
    return {
      submission,
      problem,
      canEdit,
      source: await this.sourceAccessFor(principal, facts),
    };
  }

  /** The source rule (source, its raw and download links, similarity pairs: anything that shows code): 403 `hidden` when `detailAccess` denies it, then the contest gate, then 403 `solve_first` until an `if-solved` viewer solved the problem. Solving would not help while the contest list is closed, so that reason wins over `solve_first`; a denied viewer hears `hidden` either way. */
  async viewable(
    principal: Principal,
    id: string,
    scope: ContestScope | null,
  ): Promise<{
    submission: SubmissionDocument;
    problem: ProblemDocument;
    canEdit: boolean;
  }> {
    const facts = await this.factsOf(principal, id, scope);
    if (this.detailAccessOf(principal, facts) === 'denied')
      throw new AppError('hidden', 403, 'You cannot see this submission');
    await this.assertResultOpen(principal, facts);
    if ((await this.sourceAccessFor(principal, facts)) === 'solve_first')
      throw new AppError(
        'solve_first',
        403,
        'Solve this problem to see this submission',
      );
    const { submission, problem, canEdit } = facts;
    return { submission, problem, canEdit };
  }

  private async factsOf(
    principal: Principal | null,
    id: string,
    scope: ContestScope | null,
  ): Promise<SubmissionFacts> {
    const { submission, problem } = await this.visible(principal, id, scope);
    const ownerId = uuidStr(submission.user);
    if (problem.deletedAt)
      return {
        submission,
        problem,
        ownerId,
        canEdit: false,
        contest: null,
        isContestEditor: false,
      };
    const contest = submission.contest
      ? await this.contests.findById(uuidStr(submission.contest))
      : null;
    return {
      submission,
      problem,
      ownerId,
      canEdit: ProblemAccess.canEdit(
        principal,
        ProblemAccess.accessView(problem),
      ),
      contest,
      isContestEditor:
        principal !== null &&
        contest !== null &&
        this.editsContest(principal, contest),
    };
  }

  /** 403 `contest_running` for another user's contest submission while the contest's full list is not open to the viewer (running, frozen, or an ended contest whose scoreboard stays hidden), unless they edit the contest or the problem or see every submission. */
  private async assertResultOpen(
    principal: Principal | null,
    facts: SubmissionFacts,
  ): Promise<void> {
    if (await this.isContestListClosed(principal, facts))
      throw new AppError(
        'contest_running',
        403,
        'You cannot see this submission yet',
      );
  }

  /** Legacy `can_see_detail`; only the owner and `judge.view_all_submission` get past `visible` on a deleted problem. */
  private detailAccessOf(
    principal: Principal,
    { problem, ownerId, canEdit, isContestEditor }: SubmissionFacts,
  ): DetailAccess {
    if (problem.deletedAt) return 'granted';
    return detailAccess(principal, {
      ownerId,
      problem: {
        ...ProblemAccess.accessView(problem),
        submissionSourceVisibility: problem.submissionSourceVisibility,
      },
      canEdit,
      isContestEditor,
    });
  }

  private async sourceAccessFor(
    principal: Principal | null,
    facts: SubmissionFacts,
  ): Promise<SourceAccess> {
    if (!principal) return sourceAccessOf(null, 'denied', false);
    const access = this.detailAccessOf(principal, facts);
    const hasSolved =
      access === 'if-solved' &&
      (await this.submissions.hasSolved(
        principal.userId,
        facts.problem._id,
        facts.problem.points,
      ));
    return sourceAccessOf(principal, access, hasSolved);
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
    principal: Principal | null,
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
      ownerId === principal?.userId ||
      canEdit ||
      isContestEditor ||
      (principal !== null &&
        hasPermission(principal, 'judge.view_all_submission'))
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
