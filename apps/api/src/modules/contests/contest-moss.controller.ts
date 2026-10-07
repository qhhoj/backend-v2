import { Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestMossService } from './contest-moss.service';
import { ContestMossResponse } from './dto/contest-moss.response';
import { ContestKeyParamDto } from './dto/contest-params.dto';
import { QueuedResponse } from './dto/queued.response';

@Controller('api/internal/contests')
export class ContestMossController {
  constructor(private readonly moss: ContestMossService) {}

  @Get(':key/moss')
  results(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<ContestMossResponse> {
    return this.moss.results(auth.principal, key);
  }

  @Post(':key/moss')
  @HttpCode(202)
  run(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<QueuedResponse> {
    return this.moss.run(auth.principal, key);
  }

  @Delete(':key/moss')
  @HttpCode(204)
  clear(
    @CurrentAuth() auth: AuthContext,
    @Param() { key }: ContestKeyParamDto,
  ): Promise<void> {
    return this.moss.clear(auth.principal, key);
  }
}
