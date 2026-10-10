import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import { EditorialResponse } from './dto/editorial.response';
import { ProblemDetailResponse } from './dto/problem-detail.response';
import {
  ProblemCodeParamDto,
  StatementLangQueryDto,
} from './dto/problem-params.dto';
import {
  ProblemListQueryDto,
  ProblemFilterQueryDto,
} from './dto/problem-list.dto';
import {
  ProblemListItemResponse,
  RandomProblemResponse,
} from './dto/problem-list.response';
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
  @Get('random')
  random(
    @Query() query: ProblemFilterQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<RandomProblemResponse> {
    return this.problems.randomCode(optionalPrincipal(auth), query);
  }

  @Public()
  @ApiPaginatedResponse(ProblemListItemResponse)
  @Get()
  list(
    @Query() query: ProblemListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<ProblemListItemResponse>> {
    return this.problems.list(optionalPrincipal(auth), query);
  }

  @Public()
  @Get(':code')
  detail(
    @Param() { code }: ProblemCodeParamDto,
    @Query() { lang }: StatementLangQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<ProblemDetailResponse> {
    return this.problems.detail(optionalPrincipal(auth), code, lang);
  }

  @Public()
  @Get(':code/editorial')
  editorial(
    @Param() { code }: ProblemCodeParamDto,
    @Query() { lang }: StatementLangQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<EditorialResponse> {
    return this.problems.editorial(optionalPrincipal(auth), code, lang);
  }
}
