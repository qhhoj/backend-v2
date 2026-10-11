import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { REDIS, startOfDayIn } from '@libs/common';
import { Submission, UNFINISHED_STATUSES } from '@libs/database';
import { SettingsService } from '@libs/settings';
import type Redis from 'ioredis';
import type { FilterQuery, Model } from 'mongoose';
import { JudgesRepository } from '../../judges/judges.repository';
import type {
  SubmissionStatsResponse,
  VerdictCountResponse,
} from './dto/submission-stats.response';
import { SubmissionsService } from './submissions.service';

export const STATS_CACHE_KEY = 'submissions:stats';
export const STATS_CACHE_SECONDS = 30;

/** The strip above the submission list: figures over what a signed-out viewer may see, so no hidden problem or contest leaks through a count. */
@Injectable()
export class SubmissionStatsService {
  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    private readonly list: SubmissionsService,
    private readonly judges: JudgesRepository,
    private readonly settings: SettingsService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async stats(now = new Date()): Promise<SubmissionStatsResponse> {
    const cached = await this.redis.get(STATS_CACHE_KEY);
    if (cached !== null) return JSON.parse(cached) as SubmissionStatsResponse;
    const stats = await this.compute(now);
    await this.redis.set(
      STATS_CACHE_KEY,
      JSON.stringify(stats),
      'EX',
      STATS_CACHE_SECONDS,
    );
    return stats;
  }

  private async compute(now: Date): Promise<SubmissionStatsResponse> {
    const visible = (await this.list.filterFor(null, {}, null)) ?? {
      _id: { $in: [] },
    };
    const since = startOfDayIn(this.settings.get('site.timeZone'), now);
    // Hints keep the plans on the date and status indexes whatever the visible-problem list looks like.
    const [verdicts, queueLength, judges] = await Promise.all([
      this.verdictsSince(visible, since),
      this.submissions
        .countDocuments({
          $and: [visible, { status: { $in: [...UNFINISHED_STATUSES] } }],
        })
        .hint({ status: 1, priority: 1, _id: 1 })
        .exec(),
      this.judges.counts(),
    ]);
    return {
      judgedToday: verdicts.reduce((sum, verdict) => sum + verdict.count, 0),
      acceptedToday: verdicts.find(({ result }) => result === 'AC')?.count ?? 0,
      verdictsToday: verdicts,
      queueLength,
      judgesOnline: judges.online,
      judgesTotal: judges.total,
    };
  }

  /** Visible submissions judged since `since`, counted by result in one pass over the `judgedDate` index. */
  private async verdictsSince(
    visible: FilterQuery<Submission>,
    since: Date,
  ): Promise<VerdictCountResponse[]> {
    const judged: FilterQuery<Submission> = {
      status: 'D',
      judgedDate: { $gte: since },
      result: { $ne: null },
    };
    // `aggregate` does not cast: the query casts ids and dates as `countDocuments` would.
    const match: FilterQuery<Submission> = this.submissions
      .find({ $and: [visible, judged] })
      .cast() as FilterQuery<Submission>;
    const groups = await this.submissions
      .aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: '$result', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .hint({ judgedDate: 1 })
      .exec();
    return groups.map(({ _id, count }) => ({ result: _id, count }));
  }
}
