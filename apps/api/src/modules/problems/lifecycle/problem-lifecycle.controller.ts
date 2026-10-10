import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ProblemCodeParamDto } from '../core/dto/problem-params.dto';
import { ConfirmCodeDto } from './dto/confirm-code.dto';
import { DeletedListQueryDto } from './dto/deleted-list.dto';
import { DeletedProblemResponse } from './dto/deleted-problem.response';
import { PurgeQueuedResponse } from './dto/purge-queued.response';
import { withIssues } from './lifecycle-refusals';
import { ProblemLifecycleService } from './problem-lifecycle.service';

/** `deleted` is a reserved problem code, so the static `GET /problems/deleted` never meets a problem. */
@ApiTags('Problem editing')
@Controller('api/internal/problems')
export class ProblemLifecycleController {
  constructor(private readonly lifecycle: ProblemLifecycleService) {}

  /**
   * List deleted problems awaiting purge
   *
   * @remarks
   * Needs `judge.delete_problem`. Returns one page (`page`, `pageSize` up to
   * 100) of deleted problems the caller could see before deletion, with who
   * deleted them, the whole days left before the purge job may take them
   * (`daysLeft`) and whether the heavy data is already gone (`isPurged`).
   */
  @RequirePermission('judge.delete_problem')
  @ApiPaginatedResponse(DeletedProblemResponse)
  @Get('deleted')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: DeletedListQueryDto,
  ): Promise<Paginated<DeletedProblemResponse>> {
    return withIssues(() => this.lifecycle.list(auth.principal, query));
  }

  /**
   * Delete a problem (restorable during the grace period)
   *
   * @remarks
   * Needs `judge.delete_problem` and edit rights on the problem. The body's
   * `confirmCode` must repeat the problem code. The problem is hidden at once;
   * it can be restored until the purge job removes its data after the grace
   * period (setting `problem.deleteGraceDays`), and its submissions are kept. A
   * problem used by a contest is refused with 409 `problem_in_contest`; each
   * user may delete 10 problems per hour (429 `rate_limited`). Queues a
   * recomputation of the points of everyone who solved it. Failures carry the
   * code in `error.issues[0].code`.
   */
  @RequirePermission('judge.delete_problem')
  @Delete(':code')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() { confirmCode }: ConfirmCodeDto,
  ): Promise<void> {
    return withIssues(() => this.lifecycle.remove(auth, code, confirmCode));
  }

  /**
   * Restore a deleted problem
   *
   * @remarks
   * Needs `judge.delete_problem` and edit rights. Brings the problem back, with
   * its data, until it is purged. Responds 409 `not_deleted` when the problem is
   * live and 409 `purged` when the purge has started or finished. Queues a
   * recomputation of the solvers' points.
   */
  @RequirePermission('judge.delete_problem')
  @Post(':code/restore')
  @HttpCode(204)
  restore(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<void> {
    return withIssues(() => this.lifecycle.restore(auth, code));
  }

  /**
   * Purge a deleted problem immediately
   *
   * @remarks
   * Superuser only (403 `forbidden` otherwise), and the body's `confirmCode`
   * must repeat the problem code. Queues the purge job without waiting for the
   * grace period and answers 202 `{ queued: true }`; the job deletes the test
   * data and statement files but leaves a tombstone with the code and name, and
   * all submissions. Responds 409 `purged` when the purge already finished and
   * 409 `not_deleted` for a live problem.
   */
  @RequirePermission('judge.delete_problem')
  @Post(':code/purge-now')
  @HttpCode(202)
  purgeNow(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() { confirmCode }: ConfirmCodeDto,
  ): Promise<PurgeQueuedResponse> {
    return withIssues(() => this.lifecycle.purgeNow(auth, code, confirmCode));
  }
}
