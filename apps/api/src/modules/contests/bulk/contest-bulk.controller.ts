import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ContestBulkService } from './contest-bulk.service';
import {
  BulkContestTagDto,
  BulkContestVisibilityDto,
} from './dto/contest-bulk.dto';
import { BulkContestResponse } from './dto/contest-bulk.response';

@ApiTags('Contest editing')
@Controller('api/internal/contests/bulk')
export class ContestBulkController {
  constructor(private readonly bulk: ContestBulkService) {}

  /**
   * Show or hide contests in bulk
   *
   * @remarks
   * Applies `isVisible` to each listed contest exactly as `PATCH
   * /contests/{key}` would: the caller needs edit rights on each, and showing
   * one needs `judge.change_contest_visibility` (or
   * `judge.create_private_contest` for a private contest). A refused contest
   * is reported as `failed` with the PATCH's error code and does not stop the
   * others. Limited to 20 runs per hour per user, shared with the bulk tag
   * route (429 `rate_limited`).
   */
  @Post('visibility')
  @HttpCode(200)
  visibility(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BulkContestVisibilityDto,
  ): Promise<BulkContestResponse> {
    return this.bulk.visibility(auth.principal, body);
  }

  /**
   * Add or remove a tag on contests in bulk
   *
   * @remarks
   * Requires `judge.change_contest_tag`. Adds (`assigned` true) or removes
   * the tag on each listed contest as `PATCH /contests/{key}` would, so the
   * caller needs edit rights on each and an added tag must exist. A contest
   * whose tags changed meanwhile fails with `conflict`, one already holding 20
   * tags with `too_many_tags`; failures do not stop the others. Limited to 20
   * runs per hour per user, shared with the bulk visibility route (429
   * `rate_limited`).
   */
  @RequirePermission('judge.change_contest_tag')
  @Post('tag')
  @HttpCode(200)
  tag(
    @CurrentAuth() auth: AuthContext,
    @Body() body: BulkContestTagDto,
  ): Promise<BulkContestResponse> {
    return this.bulk.tag(auth.principal, body);
  }
}
