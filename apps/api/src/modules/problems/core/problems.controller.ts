import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

@ApiTags('Problems')
@Controller('api/internal/problems')
export class ProblemsController {
  constructor(private readonly problems: ProblemsService) {}

  /**
   * List the catalogs used to classify and filter problems
   *
   * @remarks
   * Public. Returns the problem types, problem groups, licenses and judge
   * languages, each sorted by name. Use the ids to fill the filters of
   * `GET /problems` and the fields of the problem editor.
   */
  @Public()
  @Get('meta')
  meta(): ProblemMetaResponse {
    return this.problems.meta();
  }

  /**
   * Pick a random problem code
   *
   * @remarks
   * Public. Applies the same filters and visibility rules as `GET /problems`
   * (search, groups, types, points, editorial, solved, visibility) and returns
   * the code of one matching problem. Responds 404 `no_problem` when nothing
   * matches.
   */
  @Public()
  @Get('random')
  random(
    @Query() query: ProblemFilterQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<RandomProblemResponse> {
    return this.problems.randomCode(optionalPrincipal(auth), query);
  }

  /**
   * List problems visible to the viewer
   *
   * @remarks
   * Public. Returns one page of the problems the viewer may see, a signed-in
   * viewer's own solved or attempted mark included. `visibility` narrows to
   * public, private or all visible problems (default public). `search` uses the
   * text index, `q` is a substring match on the code or any title, and `sort`
   * takes `date`, `code`, `name`, `points`, `acRate` or `userCount`, with a
   * leading `-` for descending (default `-date`). Paging: `page` from 1,
   * `pageSize` 1-100 (default 50). While the viewer is in a contest, its
   * problems are listed even if private, and nothing is listed before the
   * contest starts.
   */
  @Public()
  @ApiPaginatedResponse(ProblemListItemResponse)
  @Get()
  list(
    @Query() query: ProblemListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<ProblemListItemResponse>> {
    return this.problems.list(optionalPrincipal(auth), query);
  }

  /**
   * Get a problem statement and its metadata
   *
   * @remarks
   * Public for problems the viewer may see; an unknown, malformed or invisible
   * code is 404 `not_found` either way, so existence never leaks. `lang` selects
   * the statement language and falls back to the base statement when no
   * translation exists (`translated` tells which). When the viewer can edit the
   * problem the response also carries the `editor` block with raw markdown,
   * translations and people. Inside a running contest that lists the problem,
   * `contest` reports the remaining attempts.
   */
  @Public()
  @Get(':code')
  detail(
    @Param() { code }: ProblemCodeParamDto,
    @Query() { lang }: StatementLangQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<ProblemDetailResponse> {
    return this.problems.detail(optionalPrincipal(auth), code, lang);
  }

  /**
   * Get the editorial of a problem
   *
   * @remarks
   * Public once the editorial is published (`isPublic` set and `publishOn`
   * reached). Viewers with `judge.see_private_solution` and problem editors can
   * read it earlier. Responds 404 `not_found` when there is no editorial, when
   * the viewer may not read it yet, or when the viewer is taking part in a
   * contest.
   */
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
