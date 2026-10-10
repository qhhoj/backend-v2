import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentAuth, RequirePermission } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ApiPaginatedResponse } from '@libs/common';
import type { Paginated } from '@libs/common';
import {
  CommentIdParamDto,
  CommentPageQueryDto,
} from '../core/dto/comment-params.dto';
import { CommentReportsService } from './comment-reports.service';
import { CommentReportQueueItemResponse } from './dto/comment-report-queue-item.response';
import {
  ReportCommentDto,
  SettleCommentReportsDto,
} from './dto/report-comment.dto';

@ApiTags('Comments')
@Controller('api/internal/comments')
export class CommentReportsController {
  constructor(private readonly reports: CommentReportsService) {}

  /**
   * Report a comment
   *
   * @remarks
   * Flags a visible comment of someone else for the moderators with a
   * `reason` (spam, abuse, spoiler, offTopic, other) and an optional `note`
   * (up to 500 characters). Each user reports a comment once (409
   * `conflict`); reporting one's own comment is 403 `forbidden`, a hidden or
   * deleted one 404 `not_found`. Limited to 10 reports per hour per user (429
   * `rate_limited`). Returns 204.
   */
  @Post(':id/reports')
  @HttpCode(204)
  report(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body() body: ReportCommentDto,
  ): Promise<void> {
    return this.reports.report(auth.principal, id, body);
  }

  /**
   * List reported comments
   *
   * @remarks
   * Requires `judge.change_comment`. Returns the comments with open reports,
   * the most recently reported first, 20 per page: an excerpt, the page link,
   * how many users reported it, and each open report with its reason and
   * note. Comments on pages the moderator cannot read are left out of the
   * page.
   */
  @RequirePermission('judge.change_comment')
  @ApiPaginatedResponse(CommentReportQueueItemResponse)
  @Get('reports')
  queue(
    @CurrentAuth() auth: AuthContext,
    @Query() { page }: CommentPageQueryDto,
  ): Promise<Paginated<CommentReportQueueItemResponse>> {
    return this.reports.queue(auth.principal, page);
  }

  /**
   * Settle the reports of a comment
   *
   * @remarks
   * Requires `judge.change_comment`. Marks every open report of the comment
   * `resolved` (acted on) or `dismissed`; hiding or deleting the comment is a
   * separate call. Fails with 404 `not_found` when the comment is unreadable
   * or has no open reports. Returns 204.
   */
  @RequirePermission('judge.change_comment')
  @Post(':id/reports/settle')
  @HttpCode(204)
  settle(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: CommentIdParamDto,
    @Body() { outcome }: SettleCommentReportsDto,
  ): Promise<void> {
    return this.reports.settle(auth.principal, id, outcome);
  }
}
