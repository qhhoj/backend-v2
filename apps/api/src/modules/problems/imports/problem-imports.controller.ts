import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ImportJobResponse } from './dto/import-job.response';
import {
  ImportJobParamDto,
  PolygonImportQueryDto,
} from './dto/problem-import.dto';
import { ProblemImportsService } from './problem-imports.service';

@RequirePermission('judge.import_polygon_package')
@Controller('api/internal/problems/imports')
export class ProblemImportsController {
  constructor(private readonly imports: ProblemImportsService) {}

  @Post()
  @HttpCode(202)
  start(
    @CurrentAuth() auth: AuthContext,
    @Query() query: PolygonImportQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<{ jobId: string }> {
    return this.imports.start(auth, query, request);
  }

  @Get(':jobId')
  status(
    @CurrentAuth() auth: AuthContext,
    @Param() { jobId }: ImportJobParamDto,
  ): Promise<ImportJobResponse> {
    return this.imports.status(auth, jobId);
  }
}
