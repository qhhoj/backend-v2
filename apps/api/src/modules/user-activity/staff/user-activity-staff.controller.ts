import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiHasMoreResponse, RawResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
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
@Controller('api/internal/admin/user-activity')
export class UserActivityStaffController {
  constructor(
    private readonly logs: ActivityLogsService,
    private readonly summaries: ActivitySummaryService,
    private readonly exports: ActivityExportService,
    private readonly live: ActivityLiveService,
  ) {}

  @ApiHasMoreResponse(ActivityLogResponse)
  @Get('logs')
  list(
    @Query() query: ActivityLogQueryDto,
  ): Promise<Paginated<ActivityLogResponse>> {
    return this.logs.list(query);
  }

  /** CSV attachment, streamed from a cursor: at most 100000 rows, every cell spreadsheet-safe. The filename is fixed, never built from the query. */
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

  @ApiHasMoreResponse(ActivityLogResponse)
  @Get('users/:username/logs')
  userLogs(
    @Param() { username }: UsernameParamDto,
    @Query() query: ActivityLogQueryDto,
  ): Promise<Paginated<ActivityLogResponse>> {
    return this.logs.listForUser(username, query);
  }

  @Get('users/:username/summary')
  summary(
    @Param() { username }: UsernameParamDto,
    @Query() { days }: ActivitySummaryQueryDto,
  ): Promise<ActivitySummaryResponse> {
    return this.summaries.summary(username, days);
  }

  /** Deletes the user's rows and sessions. */
  @Delete('users/:username')
  @HttpCode(204)
  deleteUser(
    @Param() { username }: UsernameParamDto,
    @CurrentAuth() auth: AuthContext,
  ): Promise<void> {
    return this.logs.deleteForUser(auth.user.username, username);
  }

  @Delete('anonymous')
  @HttpCode(204)
  deleteAnonymous(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.logs.deleteAnonymous(auth.user.username);
  }

  @Get('live')
  liveVisitors(
    @Query() { page }: ActivityPageQueryDto,
  ): Promise<LiveActivityResponse> {
    return this.live.live(page);
  }
}
