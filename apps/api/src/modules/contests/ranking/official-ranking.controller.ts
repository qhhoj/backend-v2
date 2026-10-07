import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import {
  OfficialRankingResponse,
  SetOfficialRankingDto,
} from './dto/official-ranking.dto';
import { OFFICIAL_RANKING_LIMITS } from './official-ranking';
import { OfficialRankingService } from './official-ranking.service';

/** JSON escaping can inflate a 1 MiB CSV; the DTO still refuses a longer `csv`, with a 400 rather than Fastify's 413. */
const BODY_LIMIT_BYTES = 4 * OFFICIAL_RANKING_LIMITS.bytes;

@Controller('api/internal/contests/:key/official-ranking')
export class OfficialRankingController {
  constructor(private readonly official: OfficialRankingService) {}

  @Public()
  @Get()
  show(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<OfficialRankingResponse> {
    return this.official.show(optionalPrincipal(auth), key);
  }

  @Put()
  @RouteConfig({ bodyLimit: BODY_LIMIT_BYTES })
  set(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: SetOfficialRankingDto,
  ): Promise<OfficialRankingResponse> {
    return this.official.set(auth.principal, key, dto);
  }

  @Delete()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.official.remove(auth.principal, key);
  }
}
