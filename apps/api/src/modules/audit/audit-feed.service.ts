import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { unique } from '@libs/common';
import { AuditFeedRepository } from './audit-feed.repository';
import type { AuditFilter, AuditRecord } from './audit-feed.repository';
import { AuditLabelsRepository } from './audit-labels.repository';
import type { AuditQueryDto } from './dto/audit-query.dto';
import type {
  AuditEntryResponse,
  AuditFeedResponse,
} from './dto/audit-entry.response';

const EMPTY: AuditFeedResponse = { items: [], nextBefore: null };

@Injectable()
export class AuditFeedService {
  constructor(
    private readonly feed: AuditFeedRepository,
    private readonly labels: AuditLabelsRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(query: AuditQueryDto): Promise<AuditFeedResponse> {
    const pageSize = query.limit;
    const filter = await this.filterOf(query);
    if (!filter) return EMPTY;
    const records = await this.feed.newest(filter, pageSize + 1);
    const page = records.slice(0, pageSize);
    return {
      items: await this.respond(page),
      nextBefore: records.length > pageSize ? page[page.length - 1].id : null,
    };
  }

  /** Null when the actor names nobody: the feed is empty, not unfiltered. */
  private async filterOf(query: AuditQueryDto): Promise<AuditFilter | null> {
    const filter: AuditFilter = {
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      before: query.before,
    };
    if (!query.actor) return filter;
    const actor = await this.users.findByUsername(query.actor, { _id: 1 });
    return actor ? { ...filter, actorId: actor._id } : null;
  }

  private async respond(records: AuditRecord[]): Promise<AuditEntryResponse[]> {
    const [labels, actors] = await Promise.all([
      this.labels.labels(records),
      this.users.findByIds(
        unique(records.flatMap((record) => record.actorId ?? [])),
      ),
    ]);
    const usernames = new Map(actors.map((user) => [user._id, user.username]));
    return records.map((record) => ({
      id: record.id,
      at: record.at,
      actor: record.actorId
        ? {
            id: record.actorId,
            username: usernames.get(record.actorId) ?? null,
          }
        : null,
      type: record.type,
      action: record.action,
      object: {
        id: record.objectId,
        ...labels.get(`${record.type}:${record.objectId}`)!,
      },
      changedFields: record.changedFields,
      comment: record.comment,
    }));
  }
}
