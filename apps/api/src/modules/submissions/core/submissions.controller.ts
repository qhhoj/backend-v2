import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentAuth, optionalPrincipal, Public } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse, RateLimitService } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  SubmissionDetailResponse,
  SubmissionSourceResponse,
} from './dto/submission-detail.response';
import { SubmissionListQueryDto } from './dto/submission-list.dto';
import { SubmissionListItemResponse } from './dto/submission-list.response';
import { SubmissionIdParamDto } from './dto/submission-params.dto';
import { SubmissionStatsResponse } from './dto/submission-stats.response';
import { SubmissionStatsService } from './submission-stats.service';
import {
  VISITOR_DETAIL_LIMIT,
  VISITOR_DETAIL_WINDOW_SECONDS,
  visitorDetailKey,
} from './rate-limits';
import { SubmissionsService } from './submissions.service';

@ApiTags('Submissions')
@Controller('api/internal/submissions')
export class SubmissionsController {
  constructor(
    private readonly submissions: SubmissionsService,
    private readonly stats: SubmissionStatsService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * List submissions visible to the viewer
   *
   * @remarks
   * Public. Returns one page, newest first (`page` from 1, `pageSize` 1-100,
   * default 50), of submissions on problems the viewer may see. Filter by `user`
   * (username), `problem` (code), `language` (ids, repeat the parameter),
   * `result` and `status` (repeat the parameter). Other users' submissions of a
   * contest are left out while that contest's submission list is closed to the
   * viewer. Filtering by the internal codes `IE`, `QU`, `P`, `G`, `D` or `SC` is
   * staff only (400 `validation_failed`). A deleted problem's history stays
   * visible to its submitters.
   */
  @Public()
  @ApiPaginatedResponse(SubmissionListItemResponse)
  @Get()
  list(
    @Query() query: SubmissionListQueryDto,
    @CurrentAuth() auth: AuthContext | undefined,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    return this.submissions.list(optionalPrincipal(auth), query);
  }

  /**
   * Get the judging figures shown above the submission list
   *
   * @remarks
   * Public. Returns the submissions judged and accepted today (site time zone),
   * the number of queued or running submissions and the judges online out of all
   * usable judges, counted over what a signed-out viewer may see. Cached for 30
   * seconds.
   */
  // Declared before `:id`, which would take `stats` for an id.
  @Public()
  @Get('stats')
  statistics(): Promise<SubmissionStatsResponse> {
    return this.stats.stats();
  }

  /**
   * Get a submission with its judging details
   *
   * @remarks
   * Public: the result (verdict, points, test case results) is open to anyone
   * who may see the submission's problem. Test case results follow
   * `testcaseResultVisibility`: every case, batch summaries only, or totals
   * only. The source is not part of it: `sourceAccess` tells whether the source
   * endpoint will answer (the owner, problem editors and
   * `judge.view_all_submission` always; others by the problem's
   * `submissionSourceVisibility`: everyone, only after solving the problem, or
   * owner and testers only; never visitors). Checker feedback, program output
   * and the compile log come only with source access, then by their own rules.
   * `viewer` tells which of abort, rejudge and reject the caller may use (all
   * false for visitors). Errors: 404 `not_found` and 403 `contest_running`
   * (another user's contest submission while the contest's list is not open to
   * the viewer). Visitors are limited to 300 requests per IP per minute (429
   * `rate_limited`).
   */
  @Public()
  @Get(':id')
  async detail(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext | undefined,
    @Req() request: FastifyRequest,
  ): Promise<SubmissionDetailResponse> {
    const principal = optionalPrincipal(auth);
    if (!principal)
      await this.rateLimit.reserve(
        [visitorDetailKey(request.ip)],
        VISITOR_DETAIL_LIMIT,
        VISITOR_DETAIL_WINDOW_SECONDS,
      );
    return this.submissions.detail(principal, id);
  }

  /**
   * Get the source code of a submission
   *
   * @remarks
   * Needs a signed-in user with source access (the detail's `sourceAccess`
   * is `granted`). Errors: 404 `not_found`, 403 `hidden`, 403 `solve_first`
   * (solve the problem to see it) and 403 `contest_running`. Returns the submitted source text; for a file-only
   * language it is the URL of the uploaded file.
   */
  @Get(':id/source')
  source(
    @Param() { id }: SubmissionIdParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SubmissionSourceResponse> {
    return this.submissions.source(auth.principal, id);
  }
}
