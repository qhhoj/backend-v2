import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { BulkRejudgeResponse } from '../../submissions/actions/dto/bulk-rejudge.dto';
import { QueuedResponse } from '../core/dto/queued.response';
import { ContestProblemOpsService } from './contest-problem-ops.service';
import {
  ContestProblemParamsDto,
  ContestProblemRejudgeDto,
} from './dto/contest-problem-ops.dto';

@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/problems/:code')
export class ContestProblemOpsController {
  constructor(private readonly ops: ContestProblemOpsService) {}

  /**
   * Rejudge a contest problem's submissions
   *
   * @remarks
   * Contest editors with `judge.rejudge_submission` (403 `forbidden`
   * otherwise). Rejudges the submissions sent to the problem inside this
   * contest only; submissions a judge holds and pending final-submission rows
   * are skipped, and locked ones unless `force` is set. More than 10 matches
   * also need `judge.rejudge_submission_lot` (403 `forbidden`). With `dryRun`
   * nothing changes and `count` and `allowed` report what would happen. Fails
   * with 404 `not_found` when the problem is not in the contest.
   */
  @Post('rejudge')
  @HttpCode(200)
  rejudge(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, code }: ContestProblemParamsDto,
    @Body() dto: ContestProblemRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    return this.ops.rejudge(auth.principal, key, code, dto);
  }

  /**
   * Rescore a contest problem
   *
   * @remarks
   * Contest editors only. Queues a rescore of the problem's submissions in
   * this contest and of the participations that sent one, cheaper than a full
   * contest rescore; returns 202 with `queued` true. Fails with 404
   * `not_found` when the problem is not in the contest.
   */
  @Post('rescore')
  @HttpCode(202)
  rescore(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, code }: ContestProblemParamsDto,
  ): Promise<QueuedResponse> {
    return this.ops.rescore(auth.principal, key, code);
  }
}
