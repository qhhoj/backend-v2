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
import { CommentIdParamDto } from '../core/dto/comment-params.dto';
import { CommentReportsService } from './comment-reports.service';
import { CommentReportQueueItemResponse } from './dto/comment-report-queue-item.response';
import {
  BulkSettleOutcomeResponse,
  BulkSettleReportsDto,
} from './dto/bulk-settle-reports.dto';
import {
  CommentReportQueueQueryDto,
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
   * Requires `judge.change_comment`. With `status=open` (the default),
   * returns the comments with open reports, the most recently reported
   * first; with `status=settled`, the comments whose reports were resolved or
   * dismissed, the most recently settled first. 20 per page: an excerpt, the
   * page link, how many users reported it, and each report with its reason,
   * note and, once settled, outcome and moderator. Comments on pages the
   * moderator cannot read are left out of the page.
   */
  @RequirePermission('judge.change_comment')
  @ApiPaginatedResponse(CommentReportQueueItemResponse)
  @Get('reports')
  queue(
    @CurrentAuth() auth: AuthContext,
    @Query() { page, status }: CommentReportQueueQueryDto,
  ): Promise<Paginated<CommentReportQueueItemResponse>> {
    return this.reports.queue(auth.principal, page, status);
  }

  /**
   * Settle the reports of several comments
   *
   * @remarks
   * Requires `judge.change_comment`. Settles the open reports of up to 50
   * comments with one `outcome`, each like the single settle. Returns one
   * entry per distinct id: `code` is null when settled, or the error code
   * that refused it (`not_found`: unreadable, or no open reports). A refusal
   * never stops the rest.
   */
  @RequirePermission('judge.change_comment')
  @Post('reports/settle')
  @HttpCode(200)
  settleMany(
    @CurrentAuth() auth: AuthContext,
    @Body() { ids, outcome }: BulkSettleReportsDto,
  ): Promise<BulkSettleOutcomeResponse[]> {
    return this.reports.settleMany(auth.principal, ids, outcome);
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
