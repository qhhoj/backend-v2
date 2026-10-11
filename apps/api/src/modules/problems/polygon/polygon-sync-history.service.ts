import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { PolygonSyncRun } from '@libs/database';
import { UserSummaryResponse } from '../core/dto/user-summary.response';
import { ProblemImportsService } from '../imports/problem-imports.service';
import { PolygonSyncRunResponse } from './dto/polygon-sync-run.response';
import { PolygonSyncRunsQueryDto } from './dto/polygon-sync-runs.dto';
import { PolygonSyncRunsRepository } from './polygon-sync-runs.repository';

/** The Polygon sync history: every finished import or sync job, per problem or overall. */
@Injectable()
export class PolygonSyncHistoryService {
  constructor(
    private readonly runs: PolygonSyncRunsRepository,
    private readonly imports: ProblemImportsService,
    private readonly users: UsersRepository,
  ) {}

  /** Every problem's runs name problems the caller may not edit, so the whole history needs `judge.edit_all_problem`. */
  async all(
    auth: AuthContext,
    query: PolygonSyncRunsQueryDto,
  ): Promise<Paginated<PolygonSyncRunResponse>> {
    if (!hasPermission(auth.principal, 'judge.edit_all_problem'))
      throw new AppError(
        'forbidden',
        403,
        'The whole sync history requires judge.edit_all_problem',
      );
    return this.page(undefined, query);
  }

  /** One problem's runs, with the access of its link routes; the history stays after an unlink. */
  async ofProblem(
    auth: AuthContext,
    code: string,
    query: PolygonSyncRunsQueryDto,
  ): Promise<Paginated<PolygonSyncRunResponse>> {
    const problem = await this.imports.importableProblem(auth.principal, code);
    return this.page(problem._id, query);
  }

  private async page(
    problemId: string | undefined,
    { page, pageSize }: PolygonSyncRunsQueryDto,
  ): Promise<Paginated<PolygonSyncRunResponse>> {
    const { items, total } = await this.runs.page(problemId, page, pageSize);
    const users = await this.users.findByIds(
      unique(items.map((run) => uuidStr(run.requestedBy))),
    );
    const summaries = new Map(
      users.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
    return new Paginated(
      items.map((run) => runView(run, summaries)),
      { page, pageSize, total },
    );
  }
}

const runView = (
  run: PolygonSyncRun,
  users: ReadonlyMap<string, UserSummaryResponse>,
): PolygonSyncRunResponse => ({
  id: uuidStr(run._id),
  problemId: run.problem && uuidStr(run.problem),
  code: run.code,
  polygonProblemId: run.polygonProblemId,
  polygonName: run.polygonName,
  revision: run.revision,
  packageId: run.packageId,
  packageCreatedAt: run.packageCreatedAt,
  purpose: run.purpose,
  trigger: run.trigger,
  requestedBy: users.get(uuidStr(run.requestedBy)) ?? null,
  result: run.result,
  failedStep: run.failedStep,
  error: run.error,
  finishedAt: run.createdAt,
});
