import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ShareReport } from '@libs/database';
import type { CommentReportStatus } from '@libs/database';

/** A queue tab and its report statuses. */
export const SHARE_REPORT_QUEUES = {
  open: ['open'],
  settled: ['resolved', 'dismissed'],
} as const;
export type ShareReportQueue = keyof typeof SHARE_REPORT_QUEUES;

@Injectable()
export class ShareReportsRepository {
  constructor(
    @InjectModel(ShareReport.name)
    private readonly reports: Model<ShareReport>,
  ) {}

  /** Throws the duplicate-key error when the reporter already reported the share. */
  async create(
    fields: Pick<ShareReport, 'share' | 'reporter' | 'reason' | 'note'>,
  ): Promise<void> {
    await this.reports.create(fields);
  }

  /** One page of the tab's reports, newest first, through `{status, _id}`. */
  async list(
    queue: ShareReportQueue,
    page: number,
    pageSize: number,
  ): Promise<{ items: ShareReport[]; total: number }> {
    const filter = { status: { $in: [...SHARE_REPORT_QUEUES[queue]] } };
    const [items, total] = await Promise.all([
      this.reports
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<ShareReport[]>()
        .exec(),
      this.reports.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }

  /** Settles every open report of the share; returns how many. */
  async settle(
    shareId: string,
    status: Exclude<CommentReportStatus, 'open'>,
    { settledBy, now }: { settledBy: string; now: Date },
  ): Promise<number> {
    const { modifiedCount } = await this.reports
      .updateMany(
        { share: shareId, status: 'open' },
        { $set: { status, settledBy, settledAt: now } },
      )
      .exec();
    return modifiedCount;
  }
}
