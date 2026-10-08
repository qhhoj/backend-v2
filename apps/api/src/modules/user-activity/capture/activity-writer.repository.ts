import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { classifyUserAgent } from '@libs/community';
import { newId, User, UserActivity, UserSession } from '@libs/database';
import type { AnyBulkWriteOperation, Model } from 'mongoose';
import type { ActivityRow } from './activity-row';

const DUPLICATE_KEY = 11000;

/** Every Mongo write of the capture: one `insertMany` and one `bulkWrite` per flush. */
@Injectable()
export class ActivityWriterRepository {
  constructor(
    @InjectModel(UserActivity.name)
    private readonly activities: Model<UserActivity>,
    @InjectModel(UserSession.name)
    private readonly sessions: Model<UserSession>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** The newest row of each session updates that session's summary. */
  async write(rows: ActivityRow[]): Promise<void> {
    await this.activities.insertMany(rows, { ordered: false });
    const latest = new Map<string, ActivityRow>();
    for (const row of rows) latest.set(row.sessionKey, row);
    const upserts = [...latest.values()].map((row) => ({
      updateOne: {
        filter: { sessionKey: row.sessionKey },
        update: {
          $set: {
            userId: row.userId,
            ip: row.ip,
            userAgent: row.userAgent,
            ...classifyUserAgent(row.userAgent),
            lastActivityAt: row.at,
          },
          $setOnInsert: { _id: newId() },
        },
        upsert: true,
      },
    }));
    await this.bulkUpsertSessions(upserts);
  }

  /** Two processes upserting the same new session race on the unique key; the retry then matches the winner's document. */
  private async bulkUpsertSessions(
    upserts: AnyBulkWriteOperation<UserSession>[],
  ): Promise<void> {
    try {
      await this.sessions.bulkWrite(upserts, { ordered: false });
    } catch (error) {
      if (!hasDuplicateKey(error)) throw error;
      await this.sessions.bulkWrite(upserts, { ordered: false });
    }
  }

  /** The existing `users.lastAccess` and `users.ip`; `updatedAt` stays the time of the last real edit. */
  async touchUsers(
    accesses: Array<{ userId: string; ip: string; at: Date }>,
  ): Promise<void> {
    if (!accesses.length) return;
    await this.users.bulkWrite(
      accesses.map(({ userId, ip, at }) => ({
        updateOne: {
          filter: { _id: userId },
          update: { $set: { lastAccess: at, ip } },
        },
      })),
      { ordered: false, timestamps: false },
    );
  }
}

const hasDuplicateKey = (error: unknown): boolean => {
  const { code, writeErrors } = error as {
    code?: number;
    writeErrors?: Array<{ code?: number }>;
  };
  return (
    code === DUPLICATE_KEY ||
    (writeErrors?.some((writeError) => writeError.code === DUPLICATE_KEY) ??
      false)
  );
};
