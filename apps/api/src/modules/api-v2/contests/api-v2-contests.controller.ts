import { Controller, Get, Param, UseFilters } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { ContestKeyParamDto } from '../../contests/core/dto/contest-params.dto';
import { ApiV2ContestsService } from './api-v2-contests.service';
import { ApiV2ExceptionFilter } from '../core/api-v2-exception.filter';
import { ApiV2Query, lenientQueryPipe } from '../core/api-v2-query';
import { ApiV2ContestListDto } from './dto/api-v2-contest-list.dto';
import { ApiV2ParticipationListDto } from './dto/api-v2-participation-list.dto';
import { legacyEnvelope } from '../core/legacy-envelope';

@Public()
@RawResponse()
@UseFilters(ApiV2ExceptionFilter)
@Controller('api/v2')
export class ApiV2ContestsController {
  constructor(private readonly contests: ApiV2ContestsService) {}

  @Get('contests')
  async list(
    @ApiV2Query(lenientQueryPipe) query: ApiV2ContestListDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope(
      'get',
      await this.contests.list(optionalPrincipal(auth), query),
    );
  }

  @Get('contest/:key')
  async detail(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope('get', {
      object: await this.contests.detail(optionalPrincipal(auth), key),
    });
  }

  @Get('participations')
  async participations(
    @ApiV2Query(lenientQueryPipe) query: ApiV2ParticipationListDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope(
      'get',
      await this.contests.participationList(optionalPrincipal(auth), query),
    );
  }
}
