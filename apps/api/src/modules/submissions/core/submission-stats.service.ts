import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { REDIS, startOfDayIn } from '@libs/common';
import { Submission, UNFINISHED_STATUSES } from '@libs/database';
import { SettingsService } from '@libs/settings';
import type Redis from 'ioredis';
import type { FilterQuery, Model } from 'mongoose';
import { JudgesRepository } from '../../judges/judges.repository';
import type { SubmissionStatsResponse } from './dto/submission-stats.response';
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
    const judgedToday: FilterQuery<Submission> = {
      status: 'D',
      judgedDate: { $gte: since },
    };
    // Hints keep the plans on the date and status indexes whatever the visible-problem list looks like.
    const count = (extra: FilterQuery<Submission>, hint: Record<string, 1>) =>
      this.submissions
        .countDocuments({ $and: [visible, extra] })
        .hint(hint)
        .exec();
    const [judged, accepted, queueLength, judges] = await Promise.all([
      count(judgedToday, { judgedDate: 1 }),
      count({ ...judgedToday, result: 'AC' }, { judgedDate: 1 }),
      count(
        { status: { $in: [...UNFINISHED_STATUSES] } },
        { status: 1, priority: 1, _id: 1 },
      ),
      this.judges.counts(),
    ]);
    return {
      judgedToday: judged,
      acceptedToday: accepted,
      queueLength,
      judgesOnline: judges.online,
      judgesTotal: judges.total,
    };
  }
}
