import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { PROBLEM_CODE_PATTERN, uuidStr } from '@libs/database';
import type { Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { hasPermission } from '@libs/auth';
import { ContestAccess } from '../contests/contest-access';
import { ContestViewerService } from '../contests/contest-viewer.service';
import { ContestsRepository } from '../contests/contests.repository';
import { CurrentContestService } from '../contests/current-contest.service';
import { LanguagesQuerier } from '../problems/languages.querier';
import { ProblemAccess } from '../problems/problem-access';
import type { ContestScope } from '../problems/problem-access';
import { ProblemsRepository } from '../problems/problems.repository';
import type { ProblemDocument } from '../problems/problems.repository';
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
import { SubmissionsRepository } from './submissions.repository';
import type { SubmissionDocument } from './submissions.repository';

/** `result` and `status` only feed `$in`, so they stay plain strings: `/api/v2` passes the raw query values. */
export type SubmissionFilters = Pick<
  SubmissionListQueryDto,
  'user' | 'problem' | 'language'
> & { result?: readonly string[]; status?: readonly string[] };

const STAFF_ONLY_MESSAGE = 'Only staff can filter by IE, QU, P, G, D or SC.';

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
    const visibility = caseVisibility(
      principal,
      problem,
      canEdit,
      scope !== null,
    );
    // Cases (up to 10000 rows) are loaded only for a viewer who passed the access check and sees them.
    const submission =
      visibility.cases === 'none'
        ? viewed.submission
        : ((await this.submissions.findById(id, true)) ?? viewed.submission);
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
        caseVisibility(principal, problem, canEdit, scope !== null).cases ===
        'all',
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

  /** `visible`, then 403 unless legacy `can_see_detail` lets the viewer in; another user's contest submission also needs the contest's full submission list (never during a freeze), unless the viewer edits the contest or the problem or sees every submission. */
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
    const contestView = contest && ContestAccess.accessView(contest);
    const contestEditor =
      contestView !== null &&
      (ContestAccess.isEditor(principal, contestView) ||
        hasPermission(principal, 'judge.edit_all_contest'));
    const access = detailAccess(
      principal,
      ownerId,
      {
        ...view,
        submissionSourceVisibility: problem.submissionSourceVisibility,
      },
      canEdit,
      contestEditor,
    );
    const allowed =
      access === 'granted' ||
      (access === 'if-solved' &&
        (await this.submissions.hasSolved(
          principal.userId,
          problem._id,
          problem.points,
        )));
    if (!allowed)
      throw new AppError('forbidden', 403, 'You cannot see this submission');
    if (
      contest &&
      contestView &&
      ownerId !== principal.userId &&
      !canEdit &&
      !contestEditor &&
      !hasPermission(principal, 'judge.view_all_submission')
    ) {
      const now = new Date();
      if (
        !ContestAccess.canSeeFullSubmissionList(
          principal,
          contestView,
          now,
          await this.viewers.viewerOf(principal, contest, now),
        )
      )
        throw new AppError(
          'forbidden',
          403,
          'You cannot see this submission yet',
        );
    }
    return { submission, problem, canEdit };
  }

  /** Null when nothing can match (unknown user, invisible problem); other users' submissions of contests whose list the viewer may not see (a freeze, which outlives the contest) are left out; the `/api/internal` list and `/api/v2` share it, `/api/v2` with no contest scope (legacy `get_visible_problems`). */
  async filterFor(
    principal: Principal | null,
    filters: SubmissionFilters,
    scope: ContestScope | null,
    contestId?: string,
  ): Promise<FilterQuery<Submission> | null> {
    const clauses: FilterQuery<Submission>[] =
      contestId === undefined ? [] : [{ contest: contestId }];
    if (filters.problem !== undefined) {
      const problem = PROBLEM_CODE_PATTERN.test(filters.problem)
        ? await this.problems.findByCode(filters.problem)
        : null;
      if (
        !problem ||
        (contestId === undefined &&
          !ProblemAccess.canSee(
            principal,
            ProblemAccess.accessView(problem),
            scope,
          ))
      )
        return null;
      clauses.push({ problem: problem._id });
    } else if (contestId === undefined) {
      const visible = ProblemAccess.visibleFilter(principal, scope);
      if (Object.keys(visible).length)
        clauses.push({
          problem: { $in: await this.problems.visibleIds(visible) },
        });
    }
    if (filters.user !== undefined) {
      const user = await this.users.findByUsername(filters.user);
      if (!user) return null;
      clauses.push({ user: user._id });
    }
    if (filters.language?.length)
      clauses.push({ language: { $in: filters.language } });
    if (filters.result?.length)
      clauses.push({ result: { $in: filters.result } });
    if (filters.status?.length)
      clauses.push({ status: { $in: filters.status } });
    const hidden = await this.viewers.hiddenSubmissionContests(
      principal,
      new Date(),
    );
    if (hidden.length)
      clauses.push(
        principal
          ? { $or: [{ contest: { $nin: hidden } }, { user: principal.userId }] }
          : { contest: { $nin: hidden } },
      );
    return clauses.length ? { $and: clauses } : {};
  }
}
