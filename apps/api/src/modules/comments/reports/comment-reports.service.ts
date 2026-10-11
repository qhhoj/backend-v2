import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import {
  AppError,
  isDuplicateKey,
  Paginated,
  RateLimitService,
} from '@libs/common';
import { excerpt } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Comment, CommentReport } from '@libs/database';
import type { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { CommentsRepository } from '../core/comments.repository';
import { CommentsService } from '../core/comments.service';
import { CommentPageLinkResponse } from '../core/dto/comment.response';
import { REPORT_LIMIT, REPORT_WINDOW_SECONDS } from '../core/rate-limits';
import { CommentReportsRepository } from './comment-reports.repository';
import type {
  ReportedCommentRow,
  ReportQueue,
} from './comment-reports.repository';
import type { CommentReportQueueItemResponse } from './dto/comment-report-queue-item.response';
import type { BulkSettleOutcomeResponse } from './dto/bulk-settle-reports.dto';
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

  /** Comments with open reports, newest report first (`open`), or with settled reports, newest settlement first (`settled`); comments the moderator cannot read (page access, their running contest) are left out of the page (still counted in `total`). */
  async queue(
    principal: Principal,
    page: number,
    queue: ReportQueue = 'open',
  ): Promise<Paginated<CommentReportQueueItemResponse>> {
    this.comments.assertOpen(principal);
    const { items, total } = await this.reports.commentsIn(
      queue,
      page,
      REPORT_QUEUE_PAGE_SIZE,
    );
    const ids = items.map((row) => row.commentId);
    const [rows, reports] = await Promise.all([
      this.commentRows.findByIds(ids),
      this.reports.reportsIn(queue, ids),
    ]);
    const [readable, summaryOf] = await Promise.all([
      this.comments.readablePagesOf(principal, rows),
      this.comments.summariesOf([
        ...rows.map((row) => row.author),
        ...reports.flatMap((report) =>
          report.settledBy
            ? [report.reporter, report.settledBy]
            : [report.reporter],
        ),
      ]),
    ]);
    const commentOf = new Map(rows.map((row) => [uuidStr(row._id), row]));
    return new Paginated(
      items.flatMap((row) => {
        const comment = commentOf.get(row.commentId);
        const pageInfo = readable.get(row.commentId);
        const ofComment = reports.filter(
          (report) => uuidStr(report.comment) === row.commentId,
        );
        // Settled by someone else between the two reads: nothing left to show.
        if (!comment || !pageInfo || !ofComment.length) return [];
        return [
          this.queueItem(
            {
              queue,
              row,
              comment,
              page: CommentPageLinkResponse.from(pageInfo),
            },
            ofComment,
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

  /** `settle` for each id in turn (duplicates once); each refusal is reported by its error code and never stops the rest. */
  async settleMany(
    principal: Principal,
    ids: readonly string[],
    outcome: SettledReportStatus,
  ): Promise<BulkSettleOutcomeResponse[]> {
    this.comments.assertOpen(principal);
    const outcomes: BulkSettleOutcomeResponse[] = [];
    for (const id of new Set(ids)) {
      try {
        await this.settle(principal, id, outcome);
        outcomes.push({ id, code: null });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        outcomes.push({ id, code: error.code });
      }
    }
    return outcomes;
  }

  private queueItem(
    {
      queue,
      row,
      comment,
      page,
    }: {
      queue: ReportQueue;
      row: ReportedCommentRow;
      comment: Comment;
      page: CommentPageLinkResponse;
    },
    reports: readonly CommentReport[],
    summaryOf: ReadonlyMap<string, UserSummaryResponse>,
  ): CommentReportQueueItemResponse {
    const deleted = Boolean(comment.deletedAt);
    const summary = (id: unknown) =>
      id ? (summaryOf.get(uuidStr(id)) ?? null) : null;
    return {
      comment: {
        id: row.commentId,
        excerpt: deleted ? '' : excerpt(comment.body, EXCERPT_LENGTH),
        author: summary(comment.author),
        hidden: comment.hidden,
        deleted,
      },
      page,
      reporterCount: reports.length,
      reports: reports.map((report) => ({
        reporter: summary(report.reporter),
        reason: report.reason,
        note: report.note,
        createdAt: report.createdAt,
        status: report.status,
        settledBy: summary(report.settledBy),
        settledAt: report.settledAt,
      })),
      lastReportedAt: new Date(
        Math.max(...reports.map((report) => report.createdAt.getTime())),
      ),
      lastSettledAt: queue === 'settled' ? row.lastAt : null,
    };
  }
}
