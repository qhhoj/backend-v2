import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import type { Submission } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ContestViewerService } from '../../contests/core/contest-viewer.service';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ContestScope } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { SubmissionListQueryDto } from './dto/submission-list.dto';
import { contestRowsFilter, listRowsOf, problemRowsOf } from './contest-rows';

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

/** The Mongo filter of a submission list for one viewer: their filters, the problems and contests they may see. */
@Injectable()
export class SubmissionFiltersService {
  constructor(
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
    private readonly viewers: ContestViewerService,
  ) {}

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

  /** The named problem (null when unknown or, outside a contest, invisible; only the current contest's rows and the viewer's own when seen only through that contest), else outside a contest the viewer's visible problems. */
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
    if (contestId !== undefined) return [{ problem: problem._id }];
    const rows = problemRowsOf(
      principal,
      ProblemAccess.accessView(problem),
      scope,
    );
    if (rows === 'none') return null;
    return rows === 'all'
      ? [{ problem: problem._id }]
      : [
          { problem: problem._id },
          contestRowsFilter(rows.onlyContest, principal),
        ];
  }

  /** The viewer's visible live problems (those seen only through the current contest with only that contest's rows and the viewer's own, `listRowsOf`), plus the history of deleted problems they may read (their own submissions, or every one for `judge.view_all_submission`). A viewer who sees every live problem still must not see deleted ones that are not theirs. */
  private async visibleProblemClauses(
    principal: Principal | null,
    scope: ContestScope | null,
  ): Promise<FilterQuery<Submission>[]> {
    const deleted = await this.problems.deletedIds();
    const { everyRow, contestOnly } = listRowsOf(principal, scope);
    const visible: FilterQuery<Submission> | null = Object.keys(everyRow).length
      ? { problem: { $in: await this.problems.visibleIds(everyRow) } }
      : deleted.length
        ? { problem: { $nin: deleted } }
        : null;
    if (!visible) return [];
    const live = contestOnly
      ? {
          $or: [
            visible,
            this.contestOnlyClause(principal, contestOnly, deleted),
          ],
        }
      : visible;
    const history = this.deletedHistoryClause(principal, deleted);
    return [history ? { $or: [live, history] } : live];
  }

  /** The current contest's live problems, with only `contestRowsFilter` rows. */
  private contestOnlyClause(
    principal: Principal | null,
    scope: ContestScope,
    deleted: readonly string[],
  ): FilterQuery<Submission> {
    const deletedIds = new Set(deleted);
    return {
      problem: { $in: scope.problemIds.filter((id) => !deletedIds.has(id)) },
      ...contestRowsFilter(scope, principal),
    };
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
