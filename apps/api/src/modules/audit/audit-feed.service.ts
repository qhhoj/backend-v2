import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { SUPERUSER_ONLY_KEYS } from '@libs/settings';
import { AuditFeedRepository } from './audit-feed.repository';
import type { AuditFilter, AuditRecord } from './audit-feed.repository';
import { AuditLabelsRepository } from './audit-labels.repository';
import { usernamesById } from '../organizations/requests/request-usernames';
import type { AuditQueryDto } from './dto/audit-query.dto';
import type {
  AuditEntryResponse,
  AuditFeedResponse,
} from './dto/audit-entry.response';

/** The permission that lets a viewer read the free-text note of a record of this kind: notes can carry values (an e-mail address, a user id, a contest name) that the kind's own routes protect. Kinds not listed carry fixed notes. */
const NOTE_PERMISSION: Partial<Record<string, Permission>> = {
  user: 'auth.change_user',
  problem: 'judge.edit_all_problem',
  contest: 'judge.edit_all_contest',
  contestParticipation: 'judge.edit_all_contest',
};

const EMPTY: AuditFeedResponse = { items: [], nextBefore: null };

@Injectable()
export class AuditFeedService {
  constructor(
    private readonly feed: AuditFeedRepository,
    private readonly labels: AuditLabelsRepository,
    private readonly users: UsersRepository,
  ) {}

  async list(
    query: AuditQueryDto,
    viewer: Principal,
  ): Promise<AuditFeedResponse> {
    const pageSize = query.limit;
    const filter = await this.filterOf(query, viewer);
    if (!filter) return EMPTY;
    const records = await this.feed.newest(filter, pageSize + 1);
    const page = records.slice(0, pageSize);
    return {
      items: await this.respond(page, viewer),
      nextBefore: records.length > pageSize ? page[page.length - 1].id : null,
    };
  }

  /** Null when the actor names nobody: the feed is empty, not unfiltered. */
  private async filterOf(
    query: AuditQueryDto,
    viewer: Principal,
  ): Promise<AuditFilter | null> {
    const filter: AuditFilter = {
      type: query.type,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      before: query.before?.toLowerCase(),
      hiddenSettingKeys: viewer.isSuperuser ? [] : SUPERUSER_ONLY_KEYS,
    };
    if (!query.actor) return filter;
    const actor = await this.users.findByUsername(query.actor, { _id: 1 });
    return actor ? { ...filter, actorId: actor._id } : null;
  }

  private async respond(
    records: AuditRecord[],
    viewer: Principal,
  ): Promise<AuditEntryResponse[]> {
    const [labels, usernames] = await Promise.all([
      this.labels.labels(records),
      usernamesById(
        this.users,
        records.flatMap((record) => record.actorId ?? []),
      ),
    ]);
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
      comment: noteFor(record, viewer),
    }));
  }
}

/** The note, or empty when the viewer lacks the permission its kind of record needs. */
function noteFor(record: AuditRecord, viewer: Principal): string {
  const needed = NOTE_PERMISSION[record.type];
  return needed && !hasPermission(viewer, needed) ? '' : record.comment;
}
