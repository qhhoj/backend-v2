import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { escapeRegExp } from '@libs/common';
import { ACTIVITY_PAGE_SIZE } from '@libs/community';
import { User, UserActivity, UserSession, uuidStr } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';

const FRAGMENT_USERS_MAX = 100;
/** `{ at }` only: the `{at}`, `{userId, at}` and `{ip, at}` indexes serve it as a backward scan with no sort stage. A tie-breaker on `_id` would force a blocking sort of the whole window. Rows of one millisecond may repeat or skip across a page boundary; acceptable for logs. */
const NEWEST_FIRST = { at: -1 } as const;

export interface ActivityLogRow {
  _id: string;
  userId: string | null;
  at: Date;
  ip: string;
  path: string;
  method: string;
  statusCode: number;
  userAgent: string;
  referer: string;
}

export interface DeletedCounts {
  rows: number;
  sessions: number;
}

@Injectable()
export class ActivityLogsRepository {
  constructor(
    @InjectModel(UserActivity.name)
    private readonly activities: Model<UserActivity>,
    @InjectModel(UserSession.name)
    private readonly sessions: Model<UserSession>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  /** At most 100 users whose name contains `fragment`; staff search, not a public lookup. */
  async userIdsMatching(fragment: string): Promise<string[]> {
    const rows = await this.users
      .find({ username: new RegExp(escapeRegExp(fragment), 'i') }, { _id: 1 })
      .limit(FRAGMENT_USERS_MAX)
      .lean()
      .exec();
    return rows.map((row) => uuidStr(row._id));
  }

  /** Newest first; one extra row says whether another page follows (no total: counting every row is the cost). */
  async page(
    filter: FilterQuery<UserActivity>,
    page: number,
  ): Promise<{ rows: ActivityLogRow[]; hasMore: boolean }> {
    const found = await this.activities
      .find(filter)
      .sort(NEWEST_FIRST)
      .skip((page - 1) * ACTIVITY_PAGE_SIZE)
      .limit(ACTIVITY_PAGE_SIZE + 1)
      .exec();
    return {
      rows: found.slice(0, ACTIVITY_PAGE_SIZE).map(toRow),
      hasMore: found.length > ACTIVITY_PAGE_SIZE,
    };
  }

  /** Newest first, at most `limit` rows, read through a cursor (never all in memory). */
  cursor(
    filter: FilterQuery<UserActivity>,
    limit: number,
  ): AsyncIterable<ActivityLogRow> {
    const cursor = this.activities
      .find(filter)
      .sort(NEWEST_FIRST)
      .limit(limit)
      .cursor();
    return {
      [Symbol.asyncIterator]: async function* () {
        for await (const doc of cursor) yield toRow(doc);
      },
    };
  }

  /** Rows and sessions of one user. The empty id is refused: an undefined `userId` would be dropped from the filter and delete everything. */
  async deleteForUser(userId: string): Promise<DeletedCounts> {
    if (!userId) throw new Error('deleteForUser needs a user id');
    return this.deleteWhere({ userId });
  }

  deleteAnonymous(): Promise<DeletedCounts> {
    return this.deleteWhere({ userId: null });
  }

  private async deleteWhere(owner: {
    userId: string | null;
  }): Promise<DeletedCounts> {
    const [rows, sessions] = await Promise.all([
      this.activities.deleteMany(owner),
      this.sessions.deleteMany(owner),
    ]);
    return { rows: rows.deletedCount, sessions: sessions.deletedCount };
  }
}

function toRow(doc: UserActivity): ActivityLogRow {
  return {
    _id: uuidStr(doc._id),
    userId: doc.userId === null ? null : uuidStr(doc.userId),
    at: doc.at,
    ip: doc.ip,
    path: doc.path,
    method: doc.method,
    statusCode: doc.statusCode,
    userAgent: doc.userAgent,
    referer: doc.referer,
  };
}
