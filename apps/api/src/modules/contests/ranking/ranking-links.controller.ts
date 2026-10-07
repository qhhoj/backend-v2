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

@Controller('api/internal')
export class RankingLinksController {
  constructor(private readonly links: RankingLinksService) {}

  @Get('contests/:key/ranking-link')
  show(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<RankingLinkResponse> {
    return this.links.show(auth.principal, key);
  }

  @Post('contests/:key/ranking-link')
  @HttpCode(200)
  create(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<RankingLinkResponse> {
    return this.links.create(auth.principal, key);
  }

  @Patch('contests/:key/ranking-link')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
    @Body() dto: UpdateRankingLinkDto,
  ): Promise<RankingLinkResponse> {
    return this.links.update(auth.principal, key, dto);
  }

  @Post('contests/:key/ranking-link/regenerate')
  @HttpCode(200)
  regenerate(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<RankingLinkResponse> {
    return this.links.regenerate(auth.principal, key);
  }

  @Public()
  @Get('public-rankings/:token')
  publicRanking(
    @Param() { token }: TokenParamDto,
    @Req() request: FastifyRequest,
  ): Promise<PublicRankingResponse> {
    return this.links.publicRanking(token, request.ip);
  }
}
