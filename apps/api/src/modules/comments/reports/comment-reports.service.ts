import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  isDuplicateKey,
  Paginated,
  RateLimitService,
  unique,
} from '@libs/common';
import { excerpt, pageOf, pageRef } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Comment, CommentReport } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { CommentPagesService } from '../core/comment-pages.service';
import { CommentsRepository } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import { CommentPageLinkResponse } from '../core/dto/comment.response';
import { REPORT_LIMIT, REPORT_WINDOW_SECONDS } from '../core/rate-limits';
import { CommentReportsRepository } from './comment-reports.repository';
import type { ReportedCommentRow } from './comment-reports.repository';
import type { CommentReportQueueItemResponse } from './dto/comment-report-queue-item.response';
import type {
  ReportCommentDto,
  SettledReportStatus,
} from './dto/report-comment.dto';

export const REPORT_QUEUE_PAGE_SIZE = 20;
const EXCERPT_LENGTH = 200;

/** Comment reports (new; legacy had none): any signed-in reader reports a comment once; `judge.change_comment` works the queue of open reports, grouped by comment. */
@Injectable()
export class CommentReportsService {
  constructor(
    private readonly reports: CommentReportsRepository,
    private readonly comments: CommentsService,
    private readonly commentRows: CommentsRepository,
    private readonly pages: CommentPagesService,
    private readonly users: UsersRepository,
    private readonly rateLimits: RateLimitService,
  ) {}

  /** A visible, undeleted comment of someone else; once per user (409), 10 an hour. */
  async report(
    principal: Principal,
    id: string,
    { reason, note = '' }: ReportCommentDto,
  ): Promise<void> {
    this.comments.assertOpen(principal);
    const { comment, pageInfo } = await this.comments.visibleComment(
      principal,
      id,
      { allowHidden: false, allowDeleted: false },
    );
    if (uuidStr(comment.author) === principal.userId)
      throw new AppError(
        'forbidden',
        403,
        'You cannot report your own comment',
      );
    const releaseHit = await this.rateLimits.reserve(
      [`comment-report:${principal.userId}`],
      REPORT_LIMIT,
      REPORT_WINDOW_SECONDS,
    );
    try {
      await this.reports.create({
        comment: id,
        page: pageInfo.page,
        reporter: principal.userId,
        reason,
        note: note.trim(),
      });
    } catch (error) {
      await releaseHit();
      if (isDuplicateKey(error))
        throw new AppError(
          'conflict',
          409,
          'You already reported this comment',
        );
      throw error;
    }
  }

  /** Comments with open reports, newest report first; comments on pages the moderator cannot read are left out of the page (still counted in `total`). */
  async queue(
    principal: Principal,
    page: number,
  ): Promise<Paginated<CommentReportQueueItemResponse>> {
    this.comments.assertOpen(principal);
    const { items, total } = await this.reports.openComments(
      page,
      REPORT_QUEUE_PAGE_SIZE,
    );
    const ids = items.map((row) => row.commentId);
    const [rows, reports] = await Promise.all([
      this.commentRows.findByIds(ids),
      this.reports.openOf(ids),
    ]);
    const [readable, summaryOf] = await Promise.all([
      this.pages.accessible(principal, rows.map(pageOf)),
      this.summaries([
        ...rows.map((row) => row.author),
        ...reports.map((report) => report.reporter),
      ]),
    ]);
    const commentOf = new Map(rows.map((row) => [uuidStr(row._id), row]));
    return new Paginated(
      items.flatMap((row) => {
        const comment = commentOf.get(row.commentId);
        const pageInfo = comment && readable.get(pageRef(pageOf(comment)));
        if (!comment || !pageInfo) return [];
        const open = reports.filter(
          (report) => uuidStr(report.comment) === row.commentId,
        );
        return [
          this.queueItem(
            { row, comment, page: CommentPageLinkResponse.from(pageInfo) },
            open,
            summaryOf,
          ),
        ];
      }),
      { page, pageSize: REPORT_QUEUE_PAGE_SIZE, total },
    );
  }

  /** Resolves or dismisses every open report of the comment; 404 when it has none. */
  async settle(
    principal: Principal,
    id: string,
    outcome: SettledReportStatus,
    now = new Date(),
  ): Promise<void> {
    this.comments.assertOpen(principal);
    await this.comments.visibleComment(principal, id, { allowHidden: true });
    if (!(await this.reports.settle(id, outcome, principal.userId, now)))
      throw new AppError('not_found', 404, 'No open reports on this comment');
  }

  private async summaries(
    userIds: readonly unknown[],
  ): Promise<Map<string, UserSummaryResponse>> {
    const users = await this.users.findByIds(unique(userIds.map(uuidStr)));
    return new Map(
      users.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
  }

  private queueItem(
    {
      row,
      comment,
      page,
    }: {
      row: ReportedCommentRow;
      comment: Comment;
      page: CommentPageLinkResponse;
    },
    reports: readonly CommentReport[],
    summaryOf: ReadonlyMap<string, UserSummaryResponse>,
  ): CommentReportQueueItemResponse {
    const deleted = Boolean(comment.deletedAt);
    return {
      comment: {
        id: row.commentId,
        excerpt: deleted ? '' : excerpt(comment.body, EXCERPT_LENGTH),
        author: summaryOf.get(uuidStr(comment.author)) ?? null,
        hidden: comment.hidden,
        deleted,
      },
      page,
      reporterCount: reports.length,
      reports: reports.map((report) => ({
        reporter: summaryOf.get(uuidStr(report.reporter)) ?? null,
        reason: report.reason,
        note: report.note,
        createdAt: report.createdAt,
      })),
      lastReportedAt: row.lastReportedAt,
    };
  }
}
