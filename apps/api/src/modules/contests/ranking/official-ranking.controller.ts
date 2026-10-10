import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Contest editing')
@Controller('api/internal/contests/:key/official-ranking')
export class OfficialRankingController {
  constructor(private readonly official: OfficialRankingService) {}

  /**
   * Get the official ranking of a contest
   *
   * @remarks
   * Returns the official ranking an editor uploaded after the contest (rows
   * with rank, username, full name and per-problem scores) or the URL of an
   * external ranking. The viewer must be allowed to see the scoreboard (403
   * `forbidden` otherwise); 404 `not_found` when no official ranking exists.
   */
  @Public()
  @Get()
  show(
    @Param() { key }: ContestKeyParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<OfficialRankingResponse> {
    return this.official.show(optionalPrincipal(auth), key);
  }

  /**
   * Upload the official ranking
   *
   * @remarks
   * Contest editors only. Replaces the stored official ranking with either a
   * CMS export in `csv` or an external `url` (http or https); sending both, or
   * a CSV that does not parse, fails with 400 `validation_failed`. The request
   * body is size-limited.
   */
  @Put()
  @RouteConfig({ bodyLimit: BODY_LIMIT_BYTES })
  set(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: SetOfficialRankingDto,
  ): Promise<OfficialRankingResponse> {
    return this.official.set(auth.principal, key, dto);
  }

  /**
   * Delete the official ranking
   *
   * @remarks
   * Contest editors only. Removes the stored official ranking; returns 204.
   */
  @Delete()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.official.remove(auth.principal, key);
  }
}
