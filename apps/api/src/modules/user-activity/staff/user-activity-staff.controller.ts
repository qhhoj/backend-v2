import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import {
  CurrentAuth,
  NoImpersonation,
  RequirePermission,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiHasMoreResponse, RawResponse } from '@libs/common';
import type { HasMorePageMetaResponse, Paginated } from '@libs/common';
import { UsernameParamDto } from '../../users/core/dto/username-params.dto';
import { ActivityExportService } from './activity-export.service';
import { ActivityLiveService } from './activity-live.service';
import { ActivityLogsService } from './activity-logs.service';
import { ActivitySummaryService } from './activity-summary.service';
import {
  ActivityFilterDto,
  ActivityLogQueryDto,
  ActivityPageQueryDto,
  ActivitySummaryQueryDto,
} from './dto/activity-query.dto';
import {
  ActivityLogResponse,
  ActivitySummaryResponse,
  LiveActivityResponse,
} from './dto/activity.response';

@RequirePermission('judge.can_see_user_activity')
@ApiTags('Admin: users')
@Controller('api/internal/admin/user-activity')
export class UserActivityStaffController {
  constructor(
    private readonly logs: ActivityLogsService,
    private readonly summaries: ActivitySummaryService,
    private readonly exports: ActivityExportService,
    private readonly live: ActivityLiveService,
  ) {}

  /**
   * Search the user activity log
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Returns request log rows of the last `days` (1-90, default 7), newest first, 50 per page with `hasMore` paging. `user` is a username fragment or `anonymous`, `ip` an address prefix and `path` a path fragment; a `user` fragment that matches nobody gives an empty page.
   */
  @ApiHasMoreResponse(ActivityLogResponse)
  @Get('logs')
  list(
    @Query() query: ActivityLogQueryDto,
  ): Promise<Paginated<ActivityLogResponse, HasMorePageMetaResponse>> {
    return this.logs.list(query);
  }

  /**
   * Export the user activity log as CSV
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Same filters as the log search, streamed as a `text/csv` attachment named `user-activity.csv` (newest first, at most 100000 rows, cells made spreadsheet-safe).
   */
  @RawResponse()
  @ApiResponse({
    status: 200,
    description: 'The matching rows as CSV, newest first.',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  @Get('logs/export')
  export(
    @Query() query: ActivityFilterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Readable {
    reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="user-activity.csv"')
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff');
    return Readable.from(this.exports.lines(query));
  }

  /**
   * List the activity log of one user
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Returns the user's request log rows of the last `days` (1-90, default 7), newest first, 50 per page with `hasMore` paging. 404 `not_found` for an unknown user.
   */
  @ApiHasMoreResponse(ActivityLogResponse)
  @Get('users/:username/logs')
  userLogs(
    @Param() { username }: UsernameParamDto,
    @Query() query: ActivityLogQueryDto,
  ): Promise<Paginated<ActivityLogResponse, HasMorePageMetaResponse>> {
    return this.logs.listForUser(username, query);
  }

  /**
   * Summarize one user's activity
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Returns the number of requests over the last `days` (1-90, default 90), requests per UTC day, the 20 most used IP addresses, the 30 most requested paths and the 50 most recent sessions. 404 `not_found` for an unknown user.
   */
  @Get('users/:username/summary')
  summary(
    @Param() { username }: UsernameParamDto,
    @Query() { days }: ActivitySummaryQueryDto,
  ): Promise<ActivitySummaryResponse> {
    return this.summaries.summary(username, days);
  }

  /**
   * Delete a user's activity data
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Needs a browser session (API tokens get 403) and not impersonating. Deletes the user's activity log rows and their stored sessions; the deletion is written to the server log and recorded as a `user` revision (`delete_activity`) with the counts. 403 `forbidden` when the target is yourself or a superuser and you are not a superuser; 404 `not_found` for an unknown user. Returns 204.
   */
  @SessionOnly()
  @NoImpersonation()
  @Delete('users/:username')
  @HttpCode(204)
  deleteUser(
    @Param() { username }: UsernameParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.logs.deleteForUser(auth, username);
  }

  /**
   * Delete anonymous activity data
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Needs a browser session (API tokens get 403) and not impersonating. Deletes all activity log rows and sessions of signed-out visitors; the deletion is written to the server log and recorded as a `user` revision (`delete_anonymous_activity`) on your account. Returns 204.
   */
  @SessionOnly()
  @NoImpersonation()
  @Delete('anonymous')
  @HttpCode(204)
  deleteAnonymous(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.logs.deleteAnonymous(auth);
  }

  /**
   * List who is on the site now
   *
   * @remarks
   * Requires `judge.can_see_user_activity`. Returns counts of signed-in users, anonymous visitors and bots seen in the last 30 minutes, plus a page of 50 signed-in users, most recently seen first (`hasMore` tells whether a later page exists).
   */
  @Get('live')
  liveVisitors(
    @Query() { page }: ActivityPageQueryDto,
  ): Promise<LiveActivityResponse> {
    return this.live.live(page);
  }
}
