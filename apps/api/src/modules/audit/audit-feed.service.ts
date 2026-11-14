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

/** The permission that lets a viewer read the free-text note of a record of this kind: notes can carry values (an e-mail address, a user id, a contest name, a score-override reason) that the kind's own routes protect. */
const NOTE_PERMISSION: Partial<Record<string, Permission>> = {
  user: 'auth.change_user',
  problem: 'judge.edit_all_problem',
  contest: 'judge.edit_all_contest',
  contestParticipation: 'judge.edit_all_contest',
  submission: 'judge.change_submission',
  share: 'judge.manage_share',
};

/** Kinds whose writers store only fixed notes ("Edited from site", a judge name), shown to every viewer. Any other kind without a permission above is redacted, so a new writer cannot leak by omission. */
const FIXED_NOTE_KINDS: ReadonlySet<string> = new Set([
  'tagProblem',
  'problemType',
  'problemGroup',
  'license',
  'submission_batch',
  'group',
  'organization',
  'blogPost',
  'comment',
  'flatpage',
  'judge',
  'setting',
]);

/** The permission that lets a viewer read the label of a record of this kind: these labels name objects that can be private or hidden (a private problem's code, a hidden contest's key, an unlisted organization's slug, a draft post's title, a share code). Other kinds name public things (usernames, catalog entries, pages, setting keys). */
const LABEL_PERMISSION: Partial<Record<string, Permission>> = {
  problem: 'judge.edit_all_problem',
  contest: 'judge.edit_all_contest',
  contestParticipation: 'judge.edit_all_contest',
  organization: 'judge.edit_all_organization',
  blogPost: 'judge.edit_all_post',
  share: 'judge.manage_share',
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
      object: labelFor(
        record,
        labels.get(`${record.type}:${record.objectId}`)!,
        viewer,
      ),
      changedFields: record.changedFields,
      comment: noteFor(record, viewer),
    }));
  }
}

/** The note, or empty when its kind needs a permission the viewer lacks or has no mapped permission and no fixed notes. */
function noteFor(record: AuditRecord, viewer: Principal): string {
  if (FIXED_NOTE_KINDS.has(record.type)) return record.comment;
  const needed = NOTE_PERMISSION[record.type];
  return needed && hasPermission(viewer, needed) ? record.comment : '';
}

/** The object's label, or null when its kind needs a permission the viewer lacks. */
function labelFor(
  record: AuditRecord,
  found: { label: string | null; deleted: boolean },
  viewer: Principal,
): AuditEntryResponse['object'] {
  const needed = LABEL_PERMISSION[record.type];
  const shown = !needed || hasPermission(viewer, needed);
  return {
    id: record.objectId,
    label: shown ? found.label : null,
    deleted: found.deleted,
  };
}
