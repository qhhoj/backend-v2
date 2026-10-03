import { Controller, Get, Param, Query, UseFilters } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { RawResponse } from '@libs/common';
import { ProblemCodeParamDto } from '../problems/dto/problem-params.dto';
import { ApiV2ExceptionFilter } from './api-v2-exception.filter';
import { ApiV2ProblemsService } from './api-v2-problems.service';
import { ApiV2ProblemListDto } from './dto/api-v2-problem-list.dto';
import { legacyEnvelope } from './legacy-envelope';

@Public()
@RawResponse()
@UseFilters(ApiV2ExceptionFilter)
@Controller('api/v2')
export class ApiV2ProblemsController {
  constructor(private readonly problems: ApiV2ProblemsService) {}

  @Get('problems')
  async list(
    @Query() query: ApiV2ProblemListDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope(
      'get',
      await this.problems.list(optionalPrincipal(auth), query),
    );
  }

  @Get('problem/:code')
  async detail(
    @Param() { code }: ProblemCodeParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ) {
    return legacyEnvelope('get', {
      object: await this.problems.detail(optionalPrincipal(auth), code),
    });
  }
}
