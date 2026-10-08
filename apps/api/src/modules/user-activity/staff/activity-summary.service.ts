import { Injectable } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';
import { ActivitySummaryRepository } from './activity-summary.repository';
import type { ActivitySummaryResponse } from './dto/activity.response';

const TOP_IPS = 20;
const TOP_PATHS = 30;

/** Legacy `user_activity_detail`, minus the hour-of-day and browser charts (derivable from the sessions). */
@Injectable()
export class ActivitySummaryService {
  constructor(
    private readonly logs: ActivityLogsService,
    private readonly summaries: ActivitySummaryRepository,
  ) {}

  async summary(
    username: string,
    days: number,
    now = new Date(),
  ): Promise<ActivitySummaryResponse> {
    const userId = await this.logs.userId(username);
    const since = new Date(now.getTime() - days * 86_400_000);
    const [total, daily, topIps, topPaths, sessions] = await Promise.all([
      this.summaries.total(userId, since),
      this.summaries.daily(userId, since),
      this.summaries.top(userId, since, 'ip', TOP_IPS),
      this.summaries.top(userId, since, 'path', TOP_PATHS),
      this.summaries.sessionsOf(userId),
    ]);
    return { username, total, daily, topIps, topPaths, sessions };
  }
}
