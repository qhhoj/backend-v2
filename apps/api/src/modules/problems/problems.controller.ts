import { Controller, Get, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
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
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<ProblemListItemResponse>> {
    return this.problems.list(optionalPrincipal(auth), query);
  }
}
