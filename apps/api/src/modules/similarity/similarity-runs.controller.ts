import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ListSimilarityRunsDto } from './dto/list-runs.dto';
import { SimilarityRunParamDto } from './dto/run-params.dto';
import { SimilarityRunResponse } from './dto/similarity-run.response';
import { StartSimilarityRunDto } from './dto/start-run.dto';
import { StartedSimilarityRunResponse } from './dto/started-run.response';
import { SimilarityRunsService } from './similarity-runs.service';

@RequirePermission('judge.moss_contest')
@Controller('api/internal/similarity/runs')
export class SimilarityRunsController {
  constructor(private readonly runs: SimilarityRunsService) {}

  @Post()
  @HttpCode(202)
  start(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: StartSimilarityRunDto,
  ): Promise<StartedSimilarityRunResponse> {
    return this.runs.start(auth.principal, dto);
  }

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListSimilarityRunsDto,
  ): Promise<SimilarityRunResponse[]> {
    return this.runs.list(auth.principal, query);
  }

  @Get(':runId')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param() { runId }: SimilarityRunParamDto,
  ): Promise<SimilarityRunResponse> {
    return this.runs.detail(auth.principal, runId);
  }
}
