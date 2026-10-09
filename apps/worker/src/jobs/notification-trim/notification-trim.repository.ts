import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Notification, uuidStr } from '@libs/database';
import type { Model, PipelineStage } from 'mongoose';

/** Distinct users with a row touched since `since`: the first stage is served by `{lastActivityAt: -1, user: 1}`. */
export const activeUsersPipeline = (since: Date): PipelineStage[] => [
  { $match: { lastActivityAt: { $gte: since } } },
  { $group: { _id: '$user' } },
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

  async activeSince(since: Date): Promise<string[]> {
    const groups = await this.notifications
      .aggregate<{ _id: unknown }>(activeUsersPipeline(since))
      .exec();
    return groups.map((group) => uuidStr(group._id));
  }

  count(userId: string): Promise<number> {
    return this.notifications.countDocuments({ user: userId }).exec();
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
