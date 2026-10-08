import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { toUuid, UserActivity, UserSession, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';
import type {
  ActivityCountResponse,
  ActivityDayResponse,
  ActivitySessionResponse,
} from './dto/activity.response';

const SESSIONS_SHOWN = 50;

/** Aggregates over one user's rows (`{userId, at}` index). Aggregates do not cast, hence `toUuid`. */
@Injectable()
export class ActivitySummaryRepository {
  constructor(
    @InjectModel(UserActivity.name)
    private readonly activities: Model<UserActivity>,
    @InjectModel(UserSession.name)
    private readonly sessions: Model<UserSession>,
  ) {}

  total(userId: string, since: Date): Promise<number> {
    return this.activities
      .countDocuments({ userId, at: { $gte: since } })
      .exec();
  }

  async daily(userId: string, since: Date): Promise<ActivityDayResponse[]> {
    const rows = await this.activities
      .aggregate<{ _id: string; count: number }>([
        { $match: { userId: toUuid(userId), at: { $gte: since } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    return rows.map((row) => ({ day: row._id, count: row.count }));
  }

  async top(
    userId: string,
    since: Date,
    field: 'ip' | 'path',
    limit: number,
  ): Promise<ActivityCountResponse[]> {
    const rows = await this.activities
      .aggregate<{ _id: string; count: number }>([
        { $match: { userId: toUuid(userId), at: { $gte: since } } },
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit },
      ])
      .exec();
    return rows.map((row) => ({ value: row._id, count: row.count }));
  }

  async sessionsOf(userId: string): Promise<ActivitySessionResponse[]> {
    const rows = await this.sessions
      .find({ userId })
      .sort({ lastActivityAt: -1 })
      .limit(SESSIONS_SHOWN)
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      ip: row.ip,
      userAgent: row.userAgent,
      deviceType: row.deviceType,
      browser: row.browser,
      os: row.os,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
    }));
  }
}
