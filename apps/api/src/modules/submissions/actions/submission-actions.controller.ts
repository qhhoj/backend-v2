import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { BulkRejudgeDto, BulkRejudgeResponse } from './dto/bulk-rejudge.dto';
import { SubmissionIdParamDto } from '../core/dto/submission-params.dto';
import { SubmissionActionsService } from './submission-actions.service';

@ApiTags('Judging')
@Controller('api/internal/submissions')
export class SubmissionActionsController {
  constructor(private readonly actions: SubmissionActionsService) {}

  /**
   * Rejudge many submissions of a problem
   *
   * @remarks
   * Needs `judge.rejudge_submission` and edit rights on the problem named by
   * `problem` (code). Matches the problem's submissions by optional `idFrom` and
   * `idTo`, `languages` and `results`; submissions a judge currently holds and
   * pending final-submission rows are skipped, and locked ones unless `force` is
   * set. More than 10 matches also need `judge.rejudge_submission_lot` (403
   * `forbidden`). With `dryRun` nothing changes and `count` and `allowed` report
   * what would happen. Otherwise the matches are queued at batch priority and
   * `count` is how many were reset.
   */
  @Post('rejudge')
  @HttpCode(200)
  bulkRejudge(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: BulkRejudgeDto,
  ): Promise<BulkRejudgeResponse> {
    return this.actions.bulkRejudge(auth.principal, dto);
  }

  /**
   * Abort a submission that is waiting or being judged
   *
   * @remarks
   * Allowed for the submission's owner, until an admin rejudges it, and for
   * users with `judge.abort_any_submission` (403 `forbidden` otherwise). A
   * queued submission becomes aborted at once; a running one is stopped through
   * the bridge; a finished one is left alone. Answers 204.
   */
  @Post(':id/abort')
  @HttpCode(204)
  abort(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.abort(auth.principal, id);
  }

  /**
   * Rejudge one submission
   *
   * @remarks
   * Needs `judge.rejudge_submission` and edit rights on the problem (403
   * `forbidden`). Resets the submission and queues it again at rejudge priority.
   * Responds 409 `conflict` when the submission is locked after a contest, is a
   * pending final submission or is being judged, and 409 `problem_deleted` when
   * the problem is deleted. Answers 204.
   */
  @Post(':id/rejudge')
  @HttpCode(204)
  rejudge(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.rejudge(auth.principal, id);
  }

  /**
   * Reject a submission
   *
   * @remarks
   * Needs `judge.reject_submission` and edit rights on the problem (403
   * `forbidden`). Sets the result to `RJ` with zero points and clears the case
   * results. Responds 409 `conflict` while the submission is still queued or
   * being judged, and 409 `problem_deleted` when the problem is deleted. Answers
   * 204.
   */
  @Post(':id/reject')
  @HttpCode(204)
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.reject(auth.principal, id);
  }
}
