import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestKeyParamDto } from '../core/dto/contest-params.dto';
import { TokenParamDto, UpdateRankingLinkDto } from './dto/ranking-link.dto';
import {
  PublicRankingResponse,
  RankingLinkResponse,
} from './dto/ranking-link.response';
import { RankingLinksService } from './ranking-links.service';

@ApiTags('Contest editing')
@Controller('api/internal')
export class RankingLinksController {
  constructor(private readonly links: RankingLinksService) {}

  /**
   * Get the public ranking link settings
   *
   * @remarks
   * Contest editors only. Returns the contest's public ranking link: its
   * token, status and expiry. Fails with 404 `not_found` when the contest has
   * no link yet.
   */
  @Get('contests/:key/ranking-link')
  show(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<RankingLinkResponse> {
    return this.links.show(auth.principal, key);
  }

  /**
   * Create the public ranking link
   *
   * @remarks
   * Contest editors only. Creates the public ranking link for the contest, or
   * returns the existing one. The link lets anyone with the token read the
   * ranking at `/public-rankings/{token}` without signing in.
   */
  @Post('contests/:key/ranking-link')
  @HttpCode(200)
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<RankingLinkResponse> {
    return this.links.create(auth.principal, key);
  }

  /**
   * Update the public ranking link settings
   *
   * @remarks
   * Contest editors only. Sets the link's status and its expiry: never, after
   * a number of minutes or days from the last regeneration (`expiryAmount`),
   * or at a fixed time (`expiresAt`). Fails with 404 `not_found` when the
   * contest has no link.
   */
  @Patch('contests/:key/ranking-link')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: UpdateRankingLinkDto,
  ): Promise<RankingLinkResponse> {
    return this.links.update(auth.principal, key, dto);
  }

  /**
   * Regenerate the public ranking link token
   *
   * @remarks
   * Contest editors only. Replaces the token, so the previous URL stops
   * working, and restarts relative expiry.
   */
  @Post('contests/:key/ranking-link/regenerate')
  @HttpCode(200)
  regenerate(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<RankingLinkResponse> {
    return this.links.regenerate(auth.principal, key);
  }

  /**
   * Get a ranking through its public link
   *
   * @remarks
   * Anonymous. Returns the contest's key, name and times and the ranking board
   * for a valid, unexpired, enabled token, as long as the contest shows its
   * scoreboard. Every miss is the same 404 `not_found` and spends the caller's
   * IP budget, so tokens cannot be guessed.
   */
  @Public()
  @Get('public-rankings/:token')
  publicRanking(
    @Param() { token }: TokenParamDto,
    @Req() request: FastifyRequest,
  ): Promise<PublicRankingResponse> {
    return this.links.publicRanking(token, request.ip);
  }
}
