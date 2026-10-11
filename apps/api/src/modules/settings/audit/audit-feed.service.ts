import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { Paginated, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Revision } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { AuditFeedRepository } from './audit-feed.repository';
import type {
  AuditEntryResponse,
  AuditFeedQueryDto,
} from './dto/audit-feed.dto';

export const AUDIT_PAGE_SIZE = 50;

/** Legacy `LogEntryAdmin` and the reversion browser: every recorded change of the site, newest first. A misc config revision carries its key as the note, which serves as its label. */
@Injectable()
export class AuditFeedService {
  constructor(
    private readonly feed: AuditFeedRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(query: AuditFeedQueryDto): Promise<Paginated<AuditEntryResponse>> {
    const meta = { page: query.page, pageSize: AUDIT_PAGE_SIZE };
    const filter = await this.filterOf(query);
    if (!filter) return new Paginated([], { ...meta, total: 0 });
    const { items, total } = await this.feed.page(
      filter,
      query.page,
      AUDIT_PAGE_SIZE,
    );
    const [labels, actors] = await Promise.all([
      this.feed.labelsOf(items),
      this.actorsOf(items),
    ]);
    return new Paginated(
      items.map((row) => this.entry(row, labels, actors)),
      { ...meta, total },
    );
  }

  /** Null when the named actor does not exist (nothing can match). */
  private async filterOf({
    entity,
    actor,
  }: AuditFeedQueryDto): Promise<FilterQuery<Revision> | null> {
    const filter: FilterQuery<Revision> = {};
    if (entity) filter.entity = entity;
    if (actor?.trim()) {
      const user = await this.users.findByUsername(actor.trim(), { _id: 1 });
      if (!user) return null;
      filter.userId = user._id;
    }
    return filter;
  }

  private async actorsOf(
    rows: readonly Revision[],
  ): Promise<Map<string, UserSummaryResponse>> {
    const ids = unique(
      rows.flatMap((row) => (row.userId ? [uuidStr(row.userId)] : [])),
    );
    const users = await this.users.findByIds(ids);
    return new Map(
      users.map((user) => [user._id, UserSummaryResponse.from(user)]),
    );
  }

  private entry(
    row: Revision,
    labels: ReadonlyMap<string, string>,
    actors: ReadonlyMap<string, UserSummaryResponse>,
  ): AuditEntryResponse {
    const entityId = uuidStr(row.entityId);
    const label =
      row.entity === 'miscConfig'
        ? row.comment
        : (labels.get(`${row.entity}:${entityId}`) ?? null);
    return {
      id: uuidStr(row._id),
      at: row.createdAt,
      entity: row.entity,
      entityId,
      label,
      action: row.action,
      actor: row.userId ? (actors.get(uuidStr(row.userId)) ?? null) : null,
      fields: Object.keys(row.changes ?? {}),
      comment: row.comment,
    };
  }
}
