import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, invalidField } from '@libs/common';
import { uuidStr } from '@libs/database';
import type {
  Contest,
  Problem,
  SimilarityRun,
  SimilarityScope,
} from '@libs/database';
import { ContestAccess } from '../../contests/core/contest-access';
import { ProblemAccess } from '../../problems/core/problem-access';
import type { ScopeQueryDto } from './dto/scope-query.dto';
import { SimilarityRunsRepository } from './similarity-runs.repository';

export interface ScopeTarget {
  scope: SimilarityScope;
  scopeKey: string;
  problem: string | null;
  contest: string | null;
}

export const similarityNotFound = () =>
  new AppError('not_found', 404, 'Not found');

const canEditProblem = (principal: Principal, problem: Problem) =>
  ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem));

const canEditContest = (principal: Principal, contest: Contest) =>
  ContestAccess.canEdit(principal, ContestAccess.accessView(contest));

/** Who may use similarity results: `judge.moss_contest` (checked by the guard) plus edit rights on the scope. Unknown and not editable are both 404, so nothing tells a staff member which problems and contests exist. Edit rights also settle the sources: problem and contest editors always see every submission's detail (`detailAccess` in `submissions/core/submission-access.ts`). */
@Injectable()
export class SimilarityAccessService {
  constructor(private readonly runs: SimilarityRunsRepository) {}

  async targetOf(
    principal: Principal,
    { problem, contest }: ScopeQueryDto,
  ): Promise<ScopeTarget> {
    if (problem !== undefined && contest === undefined)
      return this.problemTarget(principal, problem);
    if (contest !== undefined && problem === undefined)
      return this.contestTarget(principal, contest);
    throw invalidField(
      'problem',
      'Give exactly one of problem and contest',
      'scope_required',
    );
  }

  /** The run, when the viewer may see it and its pairs; 404 for an unknown, malformed or hidden id alike. */
  async viewableRun(
    principal: Principal,
    runId: string,
  ): Promise<SimilarityRun> {
    const run = await this.runs.findRun(runId);
    if (!run || !(await this.canView(principal, run)))
      throw similarityNotFound();
    return run;
  }

  /** Whether the viewer may see this run and its pairs. */
  private canView(principal: Principal, run: SimilarityRun): Promise<boolean> {
    if (run.scope === 'problem')
      return this.canEditProblemId(principal, run.problem);
    return this.canEditContestId(principal, run.contest);
  }

  private async canEditProblemId(
    principal: Principal,
    problemId: string | null,
  ): Promise<boolean> {
    if (problemId === null) return false;
    const problem = await this.runs.findProblemById(uuidStr(problemId));
    return problem !== null && canEditProblem(principal, problem);
  }

  private async canEditContestId(
    principal: Principal,
    contestId: string | null,
  ): Promise<boolean> {
    if (contestId === null) return false;
    const contest = await this.runs.findContestById(uuidStr(contestId));
    return contest !== null && canEditContest(principal, contest);
  }

  private async problemTarget(
    principal: Principal,
    code: string,
  ): Promise<ScopeTarget> {
    const problem = await this.runs.findProblemByCode(code);
    if (!problem || !canEditProblem(principal, problem))
      throw similarityNotFound();
    const problemId = uuidStr(problem._id);
    return {
      scope: 'problem',
      scopeKey: `problem:${problemId}`,
      problem: problemId,
      contest: null,
    };
  }

  private async contestTarget(
    principal: Principal,
    key: string,
  ): Promise<ScopeTarget> {
    const contest = await this.runs.findContestByKey(key);
    if (!contest || !canEditContest(principal, contest))
      throw similarityNotFound();
    const contestId = uuidStr(contest._id);
    return {
      scope: 'contest',
      scopeKey: `contest:${contestId}`,
      problem: null,
      contest: contestId,
    };
  }
}
