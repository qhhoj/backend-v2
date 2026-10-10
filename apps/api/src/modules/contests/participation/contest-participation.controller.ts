import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { ContestParticipationService } from './contest-participation.service';
import { ParticipationSummaryResponse } from '../core/dto/contest-detail.response';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import {
  JoinBodyDto,
  DisqualifyDto,
  ParticipationListQueryDto,
  ParticipationParamsDto,
} from './dto/participation.dto';
import {
  CurrentParticipationResponse,
  ParticipationResponse,
} from './dto/participation.response';

@ApiTags('Contests')
@Controller('api/internal/contests')
export class ContestParticipationController {
  constructor(private readonly participation: ContestParticipationService) {}

  /**
   * Get the contest the viewer is currently in
   *
   * @remarks
   * Returns the contest and participation the signed-in viewer is currently
   * taking part in, or null when they are in none. A participation whose time
   * ran out no longer counts.
   */
  @ApiExtraModels(CurrentParticipationResponse)
  @ApiOkResponse({
    description: 'Null when the viewer is in no contest.',
    schema: {
      nullable: true,
      allOf: [{ $ref: getSchemaPath(CurrentParticipationResponse) }],
    },
  })
  @Get('current')
  current(
    @CurrentAuth() auth: AuthContext,
  ): Promise<CurrentParticipationResponse | null> {
    return this.participation.current(auth.principal);
  }

  /**
   * Register for a contest
   *
   * @remarks
   * Registers the signed-in user for a contest that requires registration,
   * before registration closes. Send `accessCode` when the contest has one
   * (editors skip it) and `acceptRules` true when the contest has rules.
   * Refusals are 409 `editor_cannot_register`, `registration_not_required`,
   * `registration_closed`, `contest_ended` or `already_registered`; 403
   * `banned_from_contest`, `access_code_required` or `wrong_access_code`; and
   * 400 `rules_not_accepted`. Wrong access codes are rate limited per user and
   * per IP.
   */
  @Post(':key/register')
  register(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() { accessCode, acceptRules }: JoinBodyDto,
    @Req() request: FastifyRequest,
  ): Promise<ParticipationSummaryResponse> {
    return this.participation.register(auth.principal, key, {
      accessCode,
      acceptRules: acceptRules === true,
      ip: request.ip,
    });
  }

  /**
   * Join a contest
   *
   * @remarks
   * Makes the contest the viewer's current one and returns the participation.
   * Before the contest ends this is the live participation (created or re-
   * entered, which starts the clock after registering); after it ends it
   * creates a virtual participation unless the contest forbids it. Editors and
   * testers join as spectators. Refusals include 409 `contest_not_started`,
   * `virtual_disallowed` and `not_registered`, 403 `banned_from_contest` and
   * the access-code and rules errors listed for registering.
   */
  @Post(':key/join')
  join(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() { accessCode, acceptRules }: JoinBodyDto,
    @Req() request: FastifyRequest,
  ): Promise<ParticipationSummaryResponse> {
    return this.participation.join(auth.principal, key, {
      accessCode,
      acceptRules: acceptRules === true,
      ip: request.ip,
    });
  }

  /**
   * Leave the current contest
   *
   * @remarks
   * Clears the viewer's current-contest pointer when it points at this
   * contest, so the site is no longer scoped to it. Returns 204 on success and
   * 404 `not_in_contest` when the viewer is not in this contest.
   */
  @Post(':key/leave')
  @HttpCode(204)
  leave(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.participation.leave(auth.principal, key);
  }

  /**
   * Disqualify or reinstate a participant
   *
   * @remarks
   * Contest editors only. Sets the participation's disqualified flag to the
   * value sent (not a toggle): the contestant is banned from, or allowed back
   * into, the contest and moved out of it, the ranking cache is purged and a
   * rescore is queued by the worker. When the
   * `contest.banAfterDisqualifications` setting is above 0 the account itself
   * is banned once it reaches that many disqualifications. Fails with 404
   * `not_found` for an unknown participation and 403 `forbidden` for non-
   * editors.
   */
  @Post(':key/participations/:id/disqualify')
  disqualify(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, id }: ParticipationParamsDto,
    @Body() { disqualified }: DisqualifyDto,
  ): Promise<ParticipationSummaryResponse> {
    return this.participation.disqualify(auth.principal, key, id, disqualified);
  }

  /**
   * List participations in a contest
   *
   * @remarks
   * Returns the viewer's own participations in the contest, or anyone's for
   * contest editors (filter by `user`; other users are refused with 403 for
   * non-editors). Live and virtual participations are included (not spectator
   * rows). Results are frozen for non-editors while the ranking is frozen.
   * Paged with `page` and `pageSize`.
   */
  @ApiPaginatedResponse(ParticipationResponse)
  @Get(':key/participations')
  participations(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Query() query: ParticipationListQueryDto,
  ): Promise<Paginated<ParticipationResponse>> {
    return this.participation.participations(auth.principal, key, query);
  }
}
