import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  Language,
  Submission,
  UNFINISHED_STATUSES,
  uuidStr,
} from '@libs/database';

export interface StatusCount {
  status: string;
  count: number;
}
export interface PriorityCount {
  priority: number;
  count: number;
  oldestSince: Date;
}
export interface KeyCount {
  key: string;
  count: number;
}

const QUEUED = { status: 'QU' } as const;
/** A rejudged row waits from its rejudge, not from its submit. */
const WAITING_SINCE = { $ifNull: ['$rejudgedDate', '$date'] };

/** Read-only counts over the Mongo queue (`QU` plus `priority`, the queue truth), through `{status, priority, _id}`. */
@Injectable()
export class JudgeQueueRepository {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
  ) {}

  statusCounts(): Promise<StatusCount[]> {
    return this.submissions
      .aggregate<StatusCount>([
        { $match: { status: { $in: [...UNFINISHED_STATUSES] } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $project: { _id: 0, status: '$_id', count: 1 } },
      ])
      .exec();
  }

  byPriority(): Promise<PriorityCount[]> {
    return this.submissions
      .aggregate<PriorityCount>([
        { $match: QUEUED },
        {
          $group: {
            _id: '$priority',
            count: { $sum: 1 },
            oldestSince: { $min: WAITING_SINCE },
          },
        },
        { $project: { _id: 0, priority: '$_id', count: 1, oldestSince: 1 } },
        { $sort: { priority: 1 } },
      ])
      .exec();
  }

  /** Language ids (as strings) with their queued counts, largest first. */
  async byLanguage(): Promise<KeyCount[]> {
    const rows = await this.submissions
      .aggregate<{ _id: unknown; count: number }>([
        { $match: QUEUED },
        { $group: { _id: '$language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .exec();
    return rows.map((row) => ({ key: uuidStr(row._id), count: row.count }));
  }

  /** Judge names with the queued submissions pinned to them, largest first. */
  byPinnedJudge(): Promise<KeyCount[]> {
    return this.submissions
      .aggregate<KeyCount>([
        { $match: { ...QUEUED, pinnedJudge: { $ne: null } } },
        { $group: { _id: '$pinnedJudge', count: { $sum: 1 } } },
        { $project: { _id: 0, key: '$_id', count: 1 } },
        { $sort: { count: -1 } },
      ])
      .exec();
  }

  languagesByIds(
    ids: string[],
  ): Promise<Pick<Language, '_id' | 'key' | 'name'>[]> {
    return this.languages
      .find({ _id: { $in: ids } }, { key: 1, name: 1 })
      .lean<Pick<Language, '_id' | 'key' | 'name'>[]>()
      .exec();
  }
}
