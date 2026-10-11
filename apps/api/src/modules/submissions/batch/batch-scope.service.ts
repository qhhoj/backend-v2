import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { ContestAccess } from '../../contests/core/contest-access';
import { ContestsRepository } from '../../contests/core/contests.repository';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ProblemsService } from '../../problems/core/problems.service';
import { mayRunBatch } from './batch-filter';
import type { BatchRefs, BatchScope } from './batch-filter';
import type { SubmissionBatchFilterDto } from './dto/submission-batch.dto';

const notFound = (field: string, message: string): AppError =>
  new AppError('not_found', 404, message, undefined, undefined, {
    issues: [{ field, code: 'not_found', message }],
  });

/** Resolves a batch filter's names to ids and checks the caller may run a batch over that scope. */
@Injectable()
export class BatchScopeService {
  constructor(
    private readonly contests: ContestsRepository,
    private readonly problems: ProblemsService,
    private readonly problemRows: ProblemsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** 404 for an unknown contest, user or (outside a contest) invisible problem; 403 `forbidden` without the rights `mayRunBatch` asks for. */
  async authorize(
    principal: Principal,
    dto: SubmissionBatchFilterDto,
  ): Promise<BatchRefs> {
    const { refs, scope } = dto.contest
      ? await this.contestScope(principal, dto.contest, dto.problem)
      : await this.problemScope(principal, dto.problem);
    if (!mayRunBatch(principal, scope))
      throw new AppError(
        'forbidden',
        403,
        'You cannot manage these submissions',
      );
    return { ...refs, ...(await this.userRef(dto.user)) };
  }

  /** Legacy `ContestAdmin.rejudge_view`: the contest's editors, over its submissions only. */
  private async contestScope(
    principal: Principal,
    key: string,
    problemCode: string | undefined,
  ): Promise<{ refs: BatchRefs; scope: BatchScope }> {
    const contest = await this.contests.findByKey(key);
    const view = contest && ContestAccess.accessView(contest);
    if (!contest || !view || !ContestAccess.canSee(principal, view))
      throw notFound('contest', 'No such contest');
    const problem = problemCode
      ? await this.problemRows.findByCode(problemCode)
      : null;
    if (problemCode && !problem) throw notFound('problem', 'No such problem');
    const canEdit = ContestAccess.canEdit(principal, view);
    return {
      refs: {
        contestId: contest._id,
        ...(problem
          ? { problemId: problem._id }
          : { deletedProblemIds: await this.problemRows.deletedIds() }),
      },
      scope: { kind: 'contest', canEdit },
    };
  }

  private async problemScope(
    principal: Principal,
    code: string | undefined,
  ): Promise<{ refs: BatchRefs; scope: BatchScope }> {
    if (!code)
      return {
        refs: { deletedProblemIds: await this.problemRows.deletedIds() },
        scope: { kind: 'site' },
      };
    const problem = await this.problems.visibleProblemOutsideContest(
      principal,
      code,
    );
    const canEdit = ProblemAccess.canEdit(
      principal,
      ProblemAccess.accessView(problem),
    );
    return {
      refs: { problemId: problem._id },
      scope: { kind: 'problem', canEdit },
    };
  }

  private async userRef(username: string | undefined): Promise<BatchRefs> {
    if (username === undefined) return {};
    const user = await this.users.findByUsername(username);
    if (!user) throw notFound('user', 'No such user');
    return { userId: user._id };
  }
}
