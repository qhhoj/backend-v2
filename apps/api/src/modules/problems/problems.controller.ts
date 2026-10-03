import { Controller, Get, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { optionalPrincipal, Public } from '@libs/auth';
import type { Paginated } from '@libs/common';
import { ProblemListQueryDto } from './dto/problem-list.dto';
import { ProblemListItemResponse } from './dto/problem-list.response';
import { ProblemMetaResponse } from './dto/problem-meta.response';
import { ProblemsService } from './problems.service';

@Controller('api/internal/problems')
export class ProblemsController {
  constructor(private readonly problems: ProblemsService) {}

  @Public()
  @Get('meta')
  meta(): ProblemMetaResponse {
    return this.problems.meta();
  }

  @Public()
  @Get()
  list(
    @Query() query: ProblemListQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<Paginated<ProblemListItemResponse>> {
    return this.problems.list(optionalPrincipal(request.auth), query);
  }
}
