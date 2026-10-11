import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { SubmissionIdParamDto } from '../core/dto/submission-params.dto';
import { ScoreOverrideDto } from './dto/score-override.dto';
import { SubmissionActionsService } from './submission-actions.service';

@ApiTags('Judging')
@Controller('api/internal/submissions')
export class SubmissionActionsController {
  constructor(private readonly actions: SubmissionActionsService) {}

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

  /**
   * Override a submission's verdict and score
   *
   * @remarks
   * Needs `judge.change_submission` and edit rights on the problem (403
   * `forbidden`). Sets `result` (a graded verdict) and `points` on the
   * problem's scale; the case results stay as judged. User points, problem
   * statistics and contest results are recomputed as after a judging (an
   * `ioi16` contest still scores batches from the judged cases). Sending the
   * stored score again changes nothing. 400
   * `points_above_problem`, `points_not_partial` (a problem without partial
   * points takes 0 or full) or `accepted_needs_full_points`. 409 `conflict`
   * while the submission is queued or judged, or is a pending final
   * submission; 409 `problem_deleted` when the problem is deleted. A rejudge
   * discards the override unless `lock` locks the submission too. Logged as a
   * submission revision with `comment`. Answers 204.
   */
  @Put(':id/score')
  @HttpCode(204)
  overrideScore(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
    @Body() dto: ScoreOverrideDto,
  ): Promise<void> {
    return this.actions.overrideScore(auth.principal, id, dto);
  }

  /**
   * Lock a submission
   *
   * @remarks
   * Needs `judge.lock_submission` and edit rights on the problem (403
   * `forbidden`). A locked submission is refused by a single rejudge (409
   * `conflict`) and skipped by bulk rejudges unless they force it. Logged as a
   * submission revision. Answers 204.
   */
  @Post(':id/lock')
  @HttpCode(204)
  lock(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.setLock(auth.principal, id, true);
  }

  /**
   * Unlock a submission
   *
   * @remarks
   * Same rights as locking. Clears the lock, including one a contest set, so the
   * submission can be rejudged again. Answers 204.
   */
  @Delete(':id/lock')
  @HttpCode(204)
  unlock(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: SubmissionIdParamDto,
  ): Promise<void> {
    return this.actions.setLock(auth.principal, id, false);
  }
}
