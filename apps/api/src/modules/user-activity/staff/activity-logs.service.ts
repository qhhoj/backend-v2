import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { ACTIVITY_PAGE_SIZE } from '@libs/community';
import { activityFilter } from './activity-filter';
import type { ActivityScope } from './activity-filter';
import { ActivityLogsRepository } from './activity-logs.repository';
import type { ActivityLogRow } from './activity-logs.repository';
import type { ActivityLogQueryDto } from './dto/activity-query.dto';
import type { ActivityLogResponse } from './dto/activity.response';

@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(
    private readonly logs: ActivityLogsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** `anonymous`, a username fragment (no match = no rows) or any user. */
  async scopeOf(user?: string): Promise<ActivityScope | null> {
    if (!user) return { kind: 'any' };
    if (user === 'anonymous') return { kind: 'anonymous' };
    const ids = await this.logs.userIdsMatching(user);
    return ids.length ? { kind: 'users', ids } : null;
  }

  async list(
    query: ActivityLogQueryDto,
  ): Promise<Paginated<ActivityLogResponse>> {
    const scope = await this.scopeOf(query.user);
    const meta = (hasMore: boolean) => ({
      page: query.page,
      pageSize: ACTIVITY_PAGE_SIZE,
      hasMore,
    });
    if (!scope) return new Paginated([], meta(false));
    const { rows, hasMore } = await this.logs.page(
      activityFilter({ ...query, scope }),
      query.page,
    );
    return new Paginated(await this.respond(rows), meta(hasMore));
  }

  async listForUser(
    username: string,
    query: ActivityLogQueryDto,
  ): Promise<Paginated<ActivityLogResponse>> {
    const id = await this.userId(username);
    const { rows, hasMore } = await this.logs.page(
      activityFilter({ days: query.days, scope: { kind: 'users', ids: [id] } }),
      query.page,
    );
    return new Paginated(await this.respond(rows), {
      page: query.page,
      pageSize: ACTIVITY_PAGE_SIZE,
      hasMore,
    });
  }

  /** Audit line: who deleted whose activity and how much. */
  async deleteForUser(actor: string, username: string): Promise<void> {
    const { rows, sessions } = await this.logs.deleteForUser(
      await this.userId(username),
    );
    this.logger.log(
      `${actor} deleted the activity of ${username}: ${rows} rows, ${sessions} sessions`,
    );
  }

  async deleteAnonymous(actor: string): Promise<void> {
    const { rows, sessions } = await this.logs.deleteAnonymous();
    this.logger.log(
      `${actor} deleted the anonymous activity: ${rows} rows, ${sessions} sessions`,
    );
  }

  async userId(username: string): Promise<string> {
    const user = await this.users.findByUsername(username, { _id: 1 });
    if (!user) throw new AppError('not_found', 404, 'No such user');
    return user._id;
  }

  /** Usernames for a batch of rows in one lookup. */
  async usernames(
    rows: Array<Pick<ActivityLogRow, 'userId'>>,
  ): Promise<Map<string, string>> {
    const found = await this.users.findByIds(
      unique(rows.flatMap((row) => (row.userId ? [row.userId] : []))),
    );
    return new Map(found.map((user) => [user._id, user.username]));
  }

  private async respond(
    rows: ActivityLogRow[],
  ): Promise<ActivityLogResponse[]> {
    const names = await this.usernames(rows);
    return rows.map((row) => ({
      id: row._id,
      at: row.at,
      username: row.userId ? (names.get(row.userId) ?? null) : null,
      ip: row.ip,
      path: row.path,
      method: row.method,
      statusCode: row.statusCode,
      userAgent: row.userAgent,
      referer: row.referer,
    }));
  }
}
