import { Injectable, Logger } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import type { HasMorePageMetaResponse } from '@libs/common';
import { ACTIVITY_PAGE_SIZE } from '@libs/community';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
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
    private readonly revisions: RevisionsRepository,
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
  ): Promise<Paginated<ActivityLogResponse, HasMorePageMetaResponse>> {
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
  ): Promise<Paginated<ActivityLogResponse, HasMorePageMetaResponse>> {
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

  /** Refused for the caller's own account or a superuser's unless the caller is a superuser; leaves a `user` revision and a log line with the counts. */
  async deleteForUser(auth: AuthContext, username: string): Promise<void> {
    const target = await this.users.findByUsername(username, {
      _id: 1,
      isSuperuser: 1,
    });
    if (!target) throw new AppError('not_found', 404, 'No such user');
    const { principal } = auth;
    if (
      !principal.isSuperuser &&
      (target.isSuperuser || target._id === principal.userId)
    )
      throw new AppError(
        'forbidden',
        403,
        "Only a superuser can delete their own or a superuser's activity",
      );
    const counts = await this.logs.deleteForUser(target._id);
    await this.audit(auth, target._id, 'delete_activity', counts);
    this.logger.log(
      `${auth.user.username} deleted the activity of ${username}: ${counts.rows} rows, ${counts.sessions} sessions`,
    );
  }

  /** Recorded as a `user` revision on the caller's own account. */
  async deleteAnonymous(auth: AuthContext): Promise<void> {
    const counts = await this.logs.deleteAnonymous();
    await this.audit(
      auth,
      auth.principal.userId,
      'delete_anonymous_activity',
      counts,
    );
    this.logger.log(
      `${auth.user.username} deleted the anonymous activity: ${counts.rows} rows, ${counts.sessions} sessions`,
    );
  }

  private audit(
    auth: AuthContext,
    entityId: string,
    action: string,
    { rows, sessions }: { rows: number; sessions: number },
  ): Promise<void> {
    return this.revisions.append({
      entity: 'user',
      entityId,
      action,
      userId: auth.principal.userId,
      changes: {
        rows: { before: rows, after: 0 },
        sessions: { before: sessions, after: 0 },
      },
      comment: 'Activity deleted from site',
    });
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
