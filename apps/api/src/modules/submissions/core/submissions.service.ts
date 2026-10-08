import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { hasPermission } from '@libs/auth';
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
  staffOnlyFilter,
} from './submission-access';
import type { DetailAccess } from './submission-access';
import { SubmissionsRepository } from './submissions.repository';
import type { SubmissionDocument } from './submissions.repository';

/** `result` and `status` only feed `$in`, so they stay plain strings: `/api/v2` passes the raw query values. */
export type SubmissionFilters = Pick<
  SubmissionListQueryDto,
  'user' | 'problem' | 'language'
> & { result?: readonly string[]; status?: readonly string[] };

const STAFF_ONLY_MESSAGE = 'Only staff can filter by IE, QU, P, G, D or SC.';

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
  ) {}

  /** The viewer's current contest, resolved once per request and passed to `visible`, `viewable` and `filterFor`. */
  viewerScope(principal: Principal | null): Promise<ContestScope | null> {
    return this.currentContest.scopeOf(principal);
  }

  /** Legacy `SubmissionsListBase`: only submissions on problems the viewer can see; with `contestId`, only that contest's submissions, on any of its problems (legacy `ForceContestMixin` skips the problem filter, the contest's access check stands in for it). */
  async list(
    principal: Principal | null,
    query: SubmissionListQueryDto,
    contestId?: string,
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
      contestId === undefined ? await this.viewerScope(principal) : null,
      contestId,
    );
    if (!filter) return new Paginated([], { ...meta, total: 0 });
    const { items, total } = await this.submissions.list(
      filter,
      query.page,
      query.pageSize,
    );
    const [users, problems] = await Promise.all([
      this.users.findByIds(
        unique(items.map((submission) => uuidStr(submission.user))),
      ),
      this.problems.findSummaries(
        unique(items.map((submission) => uuidStr(submission.problem))),
      ),
    ]);
    const userOf = new Map(users.map((user) => [user._id, user]));
    const problemOf = new Map(
      problems.map((problem) => [problem._id, problem]),
    );
    return new Paginated(
      items.map((submission) =>
        SubmissionListItemResponse.from(submission, {
          user: userOf.get(uuidStr(submission.user)),
          problem: problemOf.get(uuidStr(submission.problem)),
          language: this.languages.byId(uuidStr(submission.language)),
        }),
      ),
      { ...meta, total },
    );
  }

  async detail(
    principal: Principal,
    id: string,
  ): Promise<SubmissionDetailResponse> {
    const scope = await this.viewerScope(principal);
    const viewed = await this.viewable(principal, id, scope);
    const { problem, canEdit } = viewed;
    const visibility = caseVisibility(principal, problem, {
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
    return SubmissionDetailResponse.withDetails(
      submission,
      {
        user: owner,
        problem,
        language: this.languages.byId(uuidStr(submission.language)),
      },
      {
        visibility,
        showError: canEdit || submission.status !== 'IE',
        totalCases,
      },
    );
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
        caseVisibility(principal, problem, {
          canEdit,
          isInContest: scope !== null,
        }).cases === 'all',
    };
  }

  async source(
    principal: Principal,
    id: string,
  ): Promise<SubmissionSourceResponse> {
    const { submission } = await this.viewable(
      principal,
      id,
      await this.viewerScope(principal),
    );
    return {
      id: uuidStr(submission._id),
      source: (await this.submissions.findSource(submission._id)) ?? '',
    };
  }

  /** 404 for an unknown or malformed id or a problem the viewer cannot see, whoever owns the submission. */
  async visible(
    principal: Principal,
    id: string,
    scope: ContestScope | null,
  ): Promise<{ submission: SubmissionDocument; problem: ProblemDocument }> {
    const submission = await this.submissions.findById(id);
    const problem =
      submission && (await this.problems.findById(uuidStr(submission.problem)));
    // Unlike legacy, the problem must be visible too (source visibility A never exposes a private problem).
    if (
      !submission ||
      !problem ||
      !ProblemAccess.canSee(principal, ProblemAccess.accessView(problem), scope)
    )
      throw new AppError('not_found', 404, 'No such submission');
    return { submission, problem };
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

  /** Null when nothing can match (unknown user, invisible problem); other users' submissions of contests whose list the viewer may not see (a freeze, which outlives the contest) are left out; the `/api/internal` list and `/api/v2` share it, `/api/v2` with no contest scope (legacy `get_visible_problems`). */
  async filterFor(
    principal: Principal | null,
    filters: SubmissionFilters,
    scope: ContestScope | null,
    contestId?: string,
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

  private async visibleProblemClauses(
    principal: Principal | null,
    scope: ContestScope | null,
  ): Promise<FilterQuery<Submission>[]> {
    const visible = ProblemAccess.visibleFilter(principal, scope);
    return Object.keys(visible).length
      ? [{ problem: { $in: await this.problems.visibleIds(visible) } }]
      : [];
  }

  private async userClauses(
    username: string | undefined,
  ): Promise<FilterQuery<Submission>[] | null> {
    if (username === undefined) return [];
    const user = await this.users.findByUsername(username);
    return user ? [{ user: user._id }] : null;
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
