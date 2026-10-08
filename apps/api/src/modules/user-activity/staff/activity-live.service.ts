import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { ACTIVE_WINDOW_MS, ACTIVITY_PAGE_SIZE } from '@libs/community';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { ActiveUsersStore } from '../capture/active-users.store';
import type { LiveActivityResponse } from './dto/activity.response';

/** Legacy `active_users_view`: a Redis read instead of a cached Celery snapshot. */
@Injectable()
export class ActivityLiveService {
  constructor(
    private readonly active: ActiveUsersStore,
    private readonly users: UsersRepository,
  ) {}

  async live(page: number): Promise<LiveActivityResponse> {
    const [counts, entries] = await Promise.all([
      this.active.counts(),
      this.active.users(page, ACTIVITY_PAGE_SIZE),
    ]);
    const found = new Map(
      (await this.users.findByIds(entries.map((entry) => entry.userId))).map(
        (user) => [user._id, user],
      ),
    );
    return {
      windowMinutes: ACTIVE_WINDOW_MS / 60_000,
      ...counts,
      users: entries.flatMap((entry) => {
        const user = found.get(entry.userId);
        return user
          ? [
              {
                user: UserSummaryResponse.from(user),
                lastSeenAt: entry.lastSeenAt,
              },
            ]
          : [];
      }),
    };
  }
}
