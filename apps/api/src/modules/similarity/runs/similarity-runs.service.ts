import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { SimilarityRun } from '@libs/database';
import type { ScopeQueryDto } from '../core/dto/scope-query.dto';
import { SimilarityRunResponse } from '../core/dto/similarity-run.response';
import {
  SimilarityAccessService,
  similarityNotFound,
} from '../core/similarity-access.service';
import { SimilarityRunsRepository } from '../core/similarity-runs.repository';

/** Runs listed per scope, newest first. */
const RECENT_RUNS_LIMIT = 10;

/** Reads runs of scopes the caller edits. */
@Injectable()
export class SimilarityRunsService {
  constructor(
    private readonly access: SimilarityAccessService,
    private readonly runs: SimilarityRunsRepository,
  ) {}

  async list(
    principal: Principal,
    query: ScopeQueryDto,
  ): Promise<SimilarityRunResponse[]> {
    const target = await this.access.targetOf(principal, query);
    const runs = await this.runs.recentRuns(target.scopeKey, RECENT_RUNS_LIMIT);
    return this.responsesOf(runs);
  }

  async detail(
    principal: Principal,
    runId: string,
  ): Promise<SimilarityRunResponse> {
    const run = await this.runs.findRun(runId);
    if (!run || !(await this.access.canView(principal, run)))
      throw similarityNotFound();
    const [response] = await this.responsesOf([run]);
    return response;
  }

  private async responsesOf(
    runs: SimilarityRun[],
  ): Promise<SimilarityRunResponse[]> {
    const groupProblemIds = runs.flatMap((run) =>
      run.groups.map((group) => uuidStr(group.problem)),
    );
    const problemCodes = await this.runs.problemCodes([
      ...new Set(groupProblemIds),
    ]);
    return runs.map((run) => SimilarityRunResponse.from(run, problemCodes));
  }
}
