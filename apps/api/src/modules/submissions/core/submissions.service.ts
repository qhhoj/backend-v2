import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { contestPhase } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
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
import { SubmissionContestsService } from './submission-contests.service';
import { SubmissionFiltersService } from './submission-filters.service';
import type {
  ListScope,
  SubmissionFilters,
} from './submission-filters.service';
import { isContestRow, problemRowsOf } from './contest-rows';
import { sourceFilename } from './source-file';
import { TEST_SUMMARY_CAP, testSummaryOf } from './test-summary';
import type { TestSummary } from './test-summary';
import type { SourceFile } from './source-file';
import { ExternalRunsRepository } from './external-runs.repository';
import { SubmissionsRepository } from './submissions.repository';
import type { SubmissionDocument } from './submissions.repository';

/** What the access rules read about a submission the viewer may see (`visible`); a deleted problem has no contest gate and no editors. */
interface SubmissionFacts {
  submission: SubmissionDocument;
  problem: ProblemDocument;
  ownerId: string;
  canEdit: boolean;
  contest: ContestDocument | null;
  isContestEditor: boolean;
}

type ContestRuleFacts = Pick<
  SubmissionFacts,
  'contest' | 'ownerId' | 'canEdit' | 'isContestEditor'
>;

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
    private readonly contestBlocks: SubmissionContestsService,
    private readonly filters: SubmissionFiltersService,
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
    const filter = await this.filters.filterFor(
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
    const filter = await this.filters.filterFor(
      principal,
      {},
      await this.viewerScope(principal),
      scope,
    );
    return filter ? this.submissions.count(filter) : 0;
  }

  /** List rows with their user, problem (deleted ones too) and language resolved in one read each, and the contest block the `viewer` may see (`SubmissionContestsService`, a fixed number of reads per page). Each row also carries the test summary that viewer may see (see `listCaseUnit`) unless `testSummaries` is off. */
  async listItems(
    items: readonly Submission[],
    viewer: Principal | null,
    { testSummaries = true }: { testSummaries?: boolean } = {},
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
    const [summaries, contests] = await Promise.all([
      viewer && testSummaries
        ? this.testSummaries(viewer, items, problemOf)
        : new Map<string, TestSummary>(),
      this.contestBlocks.blocksOf(viewer, items, problemOf),
    ]);
    return items.map((submission) => {
      const id = uuidStr(submission._id);
      return SubmissionListItemResponse.from(
        submission,
        {
          user: userOf.get(uuidStr(submission.user)),
          problem: problemOf.get(uuidStr(submission.problem)),
          language: this.languages.byId(uuidStr(submission.language)),
        },
        {
          testSummary: summaries.get(id) ?? null,
          contest: contests.get(id) ?? null,
        },
      );
    });
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
          isInContest: await this.hidesOutputAsInContest(scope, viewed),
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
      this.contestBlocks.blockOf(principal, submission, problem),
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

  /** `testcaseVisibility` C withholds output in contests: while the viewer is in one, and on a contest submission until its contest ends, so leaving the contest does not open it. Only C problems read the contest. */
  private async hidesOutputAsInContest(
    scope: ContestScope | null,
    {
      submission,
      problem,
    }: { submission: Submission; problem: ProblemDocument },
  ): Promise<boolean> {
    if (scope !== null) return true;
    if (problem.testcaseVisibility !== 'C' || !submission.contest) return false;
    const contest = await this.contests.findById(uuidStr(submission.contest));
    return contest !== null && contestPhase(contest, new Date()) !== 'ended';
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
      isFileOnlyLanguage:
        this.languages.byId(uuidStr(submission.language))?.fileOnly ?? false,
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

  /** A live problem must be visible to the viewer (source visibility A never exposes a private problem), and one seen only through the current contest shows only that contest's rows and the viewer's own (`problemRowsOf`); a deleted or tombstoned one keeps its history for the submission's owner and for staff who see every submission. */
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
    const rows = problemRowsOf(
      principal,
      ProblemAccess.accessView(problem),
      scope,
    );
    if (typeof rows === 'string') return rows === 'all';
    return isContestRow(submission, rows.onlyContest, principal);
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

  /** The source rule (source, its raw and download links, similarity pairs: anything that shows code): 403 `hidden` when `detailAccess` denies it, then the contest gate, then 403 `contest_running` for another user's contest source until the contest ends (`isUnfinishedContestSource`), then 403 `solve_first` until an `if-solved` viewer solved the problem. Solving would not help while the contest is on, so that reason wins over `solve_first`; a denied viewer hears `hidden` either way. */
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
    if (this.isUnfinishedContestSource(principal, facts))
      throw new AppError(
        'contest_running',
        403,
        'You cannot see this submission yet',
      );
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
    if (this.isUnfinishedContestSource(principal, facts)) return 'hidden';
    const access = this.detailAccessOf(principal, facts);
    const hasSolved =
      access === 'if-solved' &&
      (await this.submissions.hasSolved(principal.userId, facts.problem._id));
    return sourceAccessOf(principal, access, hasSolved);
  }

  private editsContest(
    principal: Principal,
    contest: ContestDocument,
  ): boolean {
    return ContestAccess.isEditorOrSiteEditor(
      principal,
      ContestAccess.accessView(contest),
    );
  }

  /** Outside a contest, the owner, the problem's or the contest's editors and `judge.view_all_submission`: the contest rules below never close a submission to them. */
  private seesPastContestRules(
    principal: Principal | null,
    { contest, ownerId, canEdit, isContestEditor }: ContestRuleFacts,
  ): boolean {
    return (
      contest === null ||
      ownerId === principal?.userId ||
      canEdit ||
      isContestEditor ||
      (principal !== null &&
        hasPermission(principal, 'judge.view_all_submission'))
    );
  }

  /** Another user's contest source stays closed to everyone but the contest's testers until the contest ends, whatever the problem's source visibility and even when the contest shows its submission list. */
  private isUnfinishedContestSource(
    principal: Principal | null,
    facts: ContestRuleFacts,
  ): boolean {
    if (this.seesPastContestRules(principal, facts)) return false;
    const contest = facts.contest!;
    return (
      contestPhase(contest, new Date()) !== 'ended' &&
      !ContestAccess.isTester(principal, ContestAccess.accessView(contest))
    );
  }

  /** Another user's contest submission stays closed until the contest's full list is open to this viewer. */
  private async isContestListClosed(
    principal: Principal | null,
    facts: ContestRuleFacts,
  ): Promise<boolean> {
    if (this.seesPastContestRules(principal, facts)) return false;
    const contest = facts.contest!;
    const now = new Date();
    return !ContestAccess.canSeeFullSubmissionList(
      principal,
      ContestAccess.accessView(contest),
      now,
      await this.viewers.viewerOf(principal, contest, now),
    );
  }
}
