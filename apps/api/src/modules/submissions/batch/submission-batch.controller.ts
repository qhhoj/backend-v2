import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import {
  BulkRejudgeDto,
  BulkRejudgeResponse,
  BulkRescoreDto,
  BulkRescoreResponse,
  SubmissionBatchLogResponse,
} from './dto/submission-batch.dto';
import { SubmissionBatchService } from './submission-batch.service';

@ApiTags('Judging')
@Controller('api/internal/submissions')
export class SubmissionBatchController {
  constructor(private readonly batches: SubmissionBatchService) {}

  /**
   * Rejudge many submissions
   *
   * @remarks
   * Needs `judge.rejudge_submission` plus edit rights on the scope: the contest
   * named by `contest` (its submissions only), else the problem named by
   * `problem`, else `judge.edit_all_problem` for a site-wide batch (403
   * `forbidden`). Narrow it with `user`, `ids`, `idFrom`/`idTo`,
   * `dateFrom`/`dateTo`, `languages`, `results` and `judgedOn`. Submissions a
   * judge currently holds and pending final-submission rows are skipped, and
   * locked ones unless `force` is set. More than 10 matches also need
   * `judge.rejudge_submission_lot` (403 `forbidden`). With `dryRun` nothing
   * changes: `count`, `allowed` and a `sample` of the newest matches report what
   * would happen. Otherwise the matches are queued at batch priority, the run is
   * logged and `count` is how many were reset. 404 `not_found` for an unknown
   * contest or user or a problem the caller cannot see.
   */
  @Post('rejudge')
  @HttpCode(200)
  rejudge(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: BulkRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    return this.batches.rejudge(auth.principal, dto);
  }

  /**
   * Recalculate the points of many submissions
   *
   * @remarks
   * Same rights and filter as the bulk rejudge, over finished submissions. With
   * a `contest` the contest's results are recomputed; otherwise every matched
   * problem is rescored (each graded submission's points from its case totals
   * and the problem's current points and partial flag, then its users, stats
   * and contests). Use it after changing a problem's points or partial flag.
   * With `dryRun` nothing is queued. The run is logged.
   */
  @Post('rescore')
  @HttpCode(200)
  rescore(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: BulkRescoreDto,
  ): Promise<BulkRescoreResponse> {
    return this.batches.rescore(auth.principal, dto);
  }

  /**
   * List recent bulk rejudges and rescores
   *
   * @remarks
   * Needs `judge.rejudge_submission`. The 20 newest runs, newest first, with who
   * ran them, the filter and how many submissions they touched. Only holders of
   * `judge.edit_all_problem` see everyone's runs; others see their own.
   */
  @RequirePermission('judge.rejudge_submission')
  @Get('batches/recent')
  recent(
    @CurrentAuth() auth: AuthContext,
  ): Promise<SubmissionBatchLogResponse[]> {
    return this.batches.recent(auth.principal);
  }
}
