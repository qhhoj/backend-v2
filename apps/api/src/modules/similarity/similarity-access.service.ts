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
import { ContestAccess } from '../contests/core/contest-access';
import { ProblemAccess } from '../problems/core/problem-access';
import { SimilarityRunsRepository } from './similarity-runs.repository';

export interface ScopeTarget {
  scope: SimilarityScope;
  scopeKey: string;
  problem: string | null;
  contest: string | null;
}

/** The scope named by a request: a problem code or a contest key. */
export interface ScopeQuery {
  problem?: string;
  contest?: string;
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
    query: ScopeQuery,
  ): Promise<ScopeTarget> {
    const hasProblem = query.problem !== undefined;
    if (hasProblem === (query.contest !== undefined))
      throw invalidField(
        'problem',
        'Give exactly one of problem and contest',
        'scope_required',
      );
    return hasProblem
      ? this.problemTarget(principal, query.problem!)
      : this.contestTarget(principal, query.contest!);
  }

  /** Whether the viewer may see this run and its pairs; callers answer 404 when not. */
  async canView(principal: Principal, run: SimilarityRun): Promise<boolean> {
    const scopeId = run.scope === 'problem' ? run.problem : run.contest;
    if (scopeId === null) return false;
    if (run.scope === 'problem') {
      const problem = await this.runs.findProblemById(uuidStr(scopeId));
      return problem !== null && canEditProblem(principal, problem);
    }
    const contest = await this.runs.findContestById(uuidStr(scopeId));
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
