import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { CommentReport, uuidStr } from '@libs/database';
import type { CommentReportStatus } from '@libs/database';

export interface ReportedCommentRow {
  commentId: string;
  lastReportedAt: Date;
}

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

  /** Comments with open reports, newest report first, one page of them, through `{status, comment}`. */
  async openComments(
    page: number,
    pageSize: number,
  ): Promise<{ items: ReportedCommentRow[]; total: number }> {
    const [result] = await this.reports
      .aggregate<{
        items: Array<{ _id: unknown; lastReportedAt: Date }>;
        total: Array<{ count: number }>;
      }>([
        { $match: { status: 'open' } },
        { $group: { _id: '$comment', lastReportedAt: { $max: '$createdAt' } } },
        { $sort: { lastReportedAt: -1, _id: -1 } },
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
        lastReportedAt: row.lastReportedAt,
      })),
      total: result.total[0]?.count ?? 0,
    };
  }

  /** The open reports of the comments, oldest first. */
  openOf(commentIds: readonly string[]): Promise<CommentReport[]> {
    if (!commentIds.length) return Promise.resolve([]);
    return this.reports
      .find({ status: 'open', comment: { $in: commentIds } })
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
