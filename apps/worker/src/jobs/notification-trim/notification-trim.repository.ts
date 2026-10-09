import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Notification, uuidStr } from '@libs/database';
import type { Model, PipelineStage } from 'mongoose';

/** The index the over-cap scan reads whole: `{user, lastActivityAt, _id}` covers the group, so no document is fetched. */
export const OVER_CAP_SCAN_INDEX = { user: 1, lastActivityAt: -1, _id: -1 };

/** Users holding more than `cap` rows. */
export const overCapUsersPipeline = (cap: number): PipelineStage[] => [
  { $group: { _id: '$user', rows: { $sum: 1 } } },
  { $match: { rows: { $gt: cap } } },
];

/** A user's rows newest first, served by `{user, lastActivityAt, _id}` with no sort stage. */
export const newestFirstQuery = (model: Model<Notification>, userId: string) =>
  model
    .find({ user: userId }, { _id: 1, lastActivityAt: 1 })
    .sort({ lastActivityAt: -1, _id: -1 });

/** A row as read. It is deleted only while its `lastActivityAt` is still this one: a merge moves the row. */
export interface TrimCandidate {
  id: string;
  lastActivityAt: Date;
}

@Injectable()
export class NotificationTrimRepository {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<Notification>,
  ) {}

  async overCap(cap: number): Promise<string[]> {
    const groups = await this.notifications
      .aggregate<{ _id: unknown }>(overCapUsersPipeline(cap))
      .hint(OVER_CAP_SCAN_INDEX)
      .exec();
    return groups.map((group) => uuidStr(group._id));
  }

  /** Up to `limit` rows past the newest `keep`. */
  async beyondNewest(
    userId: string,
    keep: number,
    limit: number,
  ): Promise<TrimCandidate[]> {
    const rows = await newestFirstQuery(this.notifications, userId)
      .skip(keep)
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      lastActivityAt: row.lastActivityAt,
    }));
  }

  /** Deletes the candidates still at the activity they were read with; returns how many went. */
  async deleteUnchanged(candidates: readonly TrimCandidate[]): Promise<number> {
    const { deletedCount } = await this.notifications
      .deleteMany({
        $or: candidates.map(({ id, lastActivityAt }) => ({
          _id: id,
          lastActivityAt,
        })),
      })
      .exec();
    return deletedCount;
  }
}
