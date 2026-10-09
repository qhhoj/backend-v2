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
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';
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

@Controller('api/internal/contests')
export class ContestParticipationController {
  constructor(private readonly participation: ContestParticipationService) {}

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

  @Post(':key/leave')
  @HttpCode(204)
  leave(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.participation.leave(auth.principal, key);
  }

  @Post(':key/participations/:id/disqualify')
  disqualify(
    @CurrentAuth() auth: AuthContext,
    @Param() { key, id }: ParticipationParamsDto,
    @Body() { disqualified }: DisqualifyDto,
  ): Promise<ParticipationSummaryResponse> {
    return this.participation.disqualify(auth.principal, key, id, disqualified);
  }

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
