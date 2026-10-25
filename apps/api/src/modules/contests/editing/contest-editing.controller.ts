import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RefuseNullFieldsPipe } from '@libs/common';
import { ContestActionsService } from './contest-actions.service';
import { ContestEditingService } from './contest-editing.service';
import { ContestRemovalService } from './contest-removal.service';
import { ContestDeleteQueryDto } from './dto/contest-delete.dto';
import { ContestActionsResponse } from './dto/contest-actions.response';
import { ContestDetailResponse } from '../core/dto/contest-detail.response';
import { CloneContestDto } from './dto/contest-clone.dto';
import {
  CreateContestDto,
  NULLABLE_CONTEST_FIELDS,
  UpdateContestDto,
} from './dto/contest-edit.dto';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';

@ApiTags('Contest editing')
@Controller('api/internal/contests')
export class ContestEditingController {
  constructor(
    private readonly editing: ContestEditingService,
    private readonly actionStatus: ContestActionsService,
    private readonly removal: ContestRemovalService,
  ) {}

  /**
   * Create a contest
   *
   * @remarks
   * Requires `judge.add_contest`. Creates a contest with the given key
   * (reserved keys fail with 400 `key_reserved`) and makes the caller its
   * author. Field errors are returned as issues (400 `validation_failed`). For
   * an organization-private contest the first listed organization is charged
   * against its quota. FSO judging and automatic publishing are scheduled for
   * the contest's end.
   */
  @RequirePermission('judge.add_contest')
  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateContestDto,
  ): Promise<ContestDetailResponse> {
    return this.editing.create(auth.principal, dto);
  }

  /**
   * Update a contest
   *
   * @remarks
   * Contest editors only. Changes the fields sent (null is refused for fields
   * that cannot be cleared). Edits that affect scoring queue a rescore, the
   * ranking cache is purged, changed rules raise the rules revision, and a new
   * lock is copied onto live submissions. Fails with 409 `conflict` when the
   * contest changed meanwhile or when leaving the final-submission format with
   * pending submissions, and with 403 `forbidden` for non-editors.
   */
  @Patch(':key')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body(new RefuseNullFieldsPipe(NULLABLE_CONTEST_FIELDS))
    dto: UpdateContestDto,
  ): Promise<ContestDetailResponse> {
    return this.editing.update(auth.principal, key, dto);
  }

  /**
   * Delete a contest
   *
   * @remarks
   * Contest editors only, with the key typed again in `confirm` (400
   * `confirmation_mismatch` otherwise). Only a hidden contest without ratings
   * or pending final submissions can be deleted, and one with live or virtual
   * participations only with `judge.edit_all_contest` (409
   * `contest_not_deletable`).
   * Its participations, announcements, ranking link, ghosts, balloons, feed
   * keys, replay and official ranking are deleted; its submissions are kept
   * outside any contest. Returns 204.
   */
  @Delete(':key')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Query() { confirm }: ContestDeleteQueryDto,
  ): Promise<void> {
    return this.removal.remove(auth.principal, key, confirm);
  }

  /**
   * Clone a contest
   *
   * @remarks
   * Requires `judge.clone_contest` and edit rights on the source. Copies
   * settings and problems to a new, hidden contest under the new key, with the
   * caller as its only author; participations, announcements and similar per-
   * contest data stay with the source. With `startTime` the copy starts then,
   * its end and registration window moved by the same amount. Reserved keys
   * fail with 400 `key_reserved`.
   */
  @RequirePermission('judge.clone_contest')
  @Post(':key/clone')
  clone(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() { key: newKey, startTime }: CloneContestDto,
  ): Promise<ContestDetailResponse> {
    return this.editing.clone(auth.principal, key, newKey, startTime);
  }

  /**
   * Rescore a contest
   *
   * @remarks
   * Contest editors only. Queues a full rescore of the contest's submissions
   * and ranking; returns 202 with `queued` true.
   */
  @Post(':key/rescore')
  @HttpCode(202)
  rescore(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.editing.rescore(auth.principal, key);
  }

  /**
   * Judge the final submissions of a contest
   *
   * @remarks
   * Contest editors only. Queues judging of the pending final submissions of
   * a final-submission contest that has started; returns 202. A running
   * contest is judged early (results become visible) and what is submitted
   * afterwards waits for the end. Fails with 409 `conflict` for any other
   * format or before the start.
   */
  @Post(':key/judge-final')
  @HttpCode(202)
  judgeFinal(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.editing.judgeFinal(auth.principal, key);
  }

  /**
   * Get the available editor actions of a contest
   *
   * @remarks
   * Contest editors only. Reports, for each background action of the contest
   * (rescore, judge final, rate, publish problems, rebuild replay, export),
   * whether its job is currently queued or running, so the editing UI can show
   * progress and disable buttons.
   */
  @Get(':key/actions')
  actions(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestActionsResponse> {
    return this.actionStatus.status(auth.principal, key);
  }
}
