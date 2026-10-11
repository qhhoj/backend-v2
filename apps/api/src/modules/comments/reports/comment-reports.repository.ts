import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CommentReport, uuidStr } from '@libs/database';
import type { CommentReportStatus } from '@libs/database';

export interface ReportedCommentRow {
  commentId: string;
  /** The newest report of the group: `createdAt` for open reports, `settledAt` for settled ones. */
  lastAt: Date;
}

/** A queue tab: its report statuses and the time its groups sort by, newest first. */
const QUEUES = {
  open: { statuses: ['open'], newest: '$createdAt' },
  settled: { statuses: ['resolved', 'dismissed'], newest: '$settledAt' },
} as const;
export type ReportQueue = keyof typeof QUEUES;

@Injectable()
export class CommentReportsRepository {
  constructor(
    @InjectModel(CommentReport.name)
    private readonly reports: Model<CommentReport>,
  ) {}

  /** Throws the duplicate-key error when the reporter already reported the comment. */
  async create(
    fields: Pick<
      CommentReport,
      'comment' | 'page' | 'reporter' | 'reason' | 'note'
    >,
  ): Promise<void> {
    await this.reports.create(fields);
  }

  /** Comments with reports of the queue's statuses, newest first, one page of them, through `{status, comment}`. */
  async commentsIn(
    queue: ReportQueue,
    page: number,
    pageSize: number,
  ): Promise<{ items: ReportedCommentRow[]; total: number }> {
    const { statuses, newest } = QUEUES[queue];
    const [result] = await this.reports
      .aggregate<{
        items: Array<{ _id: unknown; lastAt: Date }>;
        total: Array<{ count: number }>;
      }>([
        { $match: { status: { $in: statuses } } },
        { $group: { _id: '$comment', lastAt: { $max: newest } } },
        { $sort: { lastAt: -1, _id: -1 } },
        {
          $facet: {
            items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();
    return {
      items: result.items.map((row) => ({
        commentId: uuidStr(row._id),
        lastAt: row.lastAt,
      })),
      total: result.total[0]?.count ?? 0,
    };
  }

  /** The comments' reports of the queue's statuses, oldest first. */
  reportsIn(
    queue: ReportQueue,
    commentIds: readonly string[],
  ): Promise<CommentReport[]> {
    if (!commentIds.length) return Promise.resolve([]);
    return this.reports
      .find({
        status: { $in: QUEUES[queue].statuses },
        comment: { $in: commentIds },
      })
      .sort({ createdAt: 1, _id: 1 })
      .lean<CommentReport[]>()
      .exec();
  }

  /** Settles every open report of the comment; returns how many. */
  async settle(
    commentId: string,
    status: Exclude<CommentReportStatus, 'open'>,
    settledBy: string,
    now: Date,
  ): Promise<number> {
    const { modifiedCount } = await this.reports
      .updateMany(
        { comment: commentId, status: 'open' },
        { $set: { status, settledBy, settledAt: now } },
      )
      .exec();
    return modifiedCount;
  }
}
