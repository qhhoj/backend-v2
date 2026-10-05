import { Body, Controller, Get, Param, Put, Res } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { DATA_BODY_LIMIT_BYTES } from './dto/limits';
import { PutProblemDataDto } from './dto/problem-data.dto';
import { ProblemDataResponse } from './dto/problem-data.response';
import { ProblemCodeParamDto } from './dto/problem-params.dto';
import { ProblemDataService } from './problem-data.service';

@Controller('api/internal/problems')
export class ProblemDataController {
  constructor(private readonly data: ProblemDataService) {}

  @Get(':code/data')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
  ): Promise<ProblemDataResponse> {
    return this.data.get(auth, code);
  }

  @RouteConfig({ bodyLimit: DATA_BODY_LIMIT_BYTES })
  @Put(':code/data')
  put(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Body() body: PutProblemDataDto,
  ): Promise<ProblemDataResponse> {
    return this.data.put(auth, code, body);
  }

  @RawResponse()
  @Get(':code/data/init')
  async init(
    @CurrentAuth() auth: AuthContext,
    @Param() { code }: ProblemCodeParamDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    const yaml = await this.data.init(auth, code);
    reply.type('text/yaml; charset=utf-8');
    return yaml;
  }
}
