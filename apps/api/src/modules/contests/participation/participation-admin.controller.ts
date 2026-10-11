import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ParticipationSummaryResponse } from '../core/dto/contest-detail.response';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { QueuedResponse } from '../core/dto/queued.response';
import { ParticipationParamsDto } from './dto/participation.dto';
import {
  AddParticipationDto,
  UpdateParticipationDto,
} from './dto/participation-admin.dto';
import { ParticipationAdminService } from './participation-admin.service';

@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/participations')
export class ParticipationAdminController {
  constructor(private readonly admin: ParticipationAdminService) {}

  /**
   * Add a participation
   *
   * @remarks
   * Contest editors only. Adds a live participation (409
   * `already_participating` when the user has one) or a new virtual run for
   * the user, starting at `realStart` (default: now while the contest runs,
   * else the contest start for a live row and now for a virtual one). The
   * user's current contest is not changed. Fails with 400 `validation_failed`
   * (issue `user_unknown`) and 409 `banned_from_contest`.
   */
  @Post()
  add(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: AddParticipationDto,
  ): Promise<ParticipationSummaryResponse> {
    return this.admin.add(auth.principal, key, dto);
  }

  /**
   * Change a participation's start
   *
   * @remarks
   * Contest editors only. Sets `realStart` (a pending registration counts as
   * started), purges the ranking cache and queues a recompute of the
   * participation. Fails with 404 `not_found`.
   */
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, id }: ParticipationParamsDto,
    @Body() dto: UpdateParticipationDto,
  ): Promise<ParticipationSummaryResponse> {
    return this.admin.update(auth.principal, key, id, dto);
  }

  /**
   * Delete a participation
   *
   * @remarks
   * Contest editors only. Deletes a participation that has no submissions
   * (409 `participation_has_submissions` otherwise: disqualify it instead) and
   * clears the user's current contest when it pointed there. Returns 204;
   * 404 `not_found` for an unknown participation.
   */
  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, id }: ParticipationParamsDto,
  ): Promise<void> {
    return this.admin.remove(auth.principal, key, id);
  }

  /**
   * Recompute a participation
   *
   * @remarks
   * Contest editors only. Queues a rescore of the participation's submissions
   * and results, for one stale score; returns 202 with `queued` true.
   */
  @Post(':id/recompute')
  @HttpCode(202)
  recompute(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, id }: ParticipationParamsDto,
  ): Promise<QueuedResponse> {
    return this.admin.recompute(auth.principal, key, id);
  }
}
