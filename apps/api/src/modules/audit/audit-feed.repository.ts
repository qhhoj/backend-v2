import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, Model } from 'mongoose';
import { Revision, SettingRevision, uuidStr } from '@libs/database';
import { SETTING_TYPE } from './audit-types';
import type { AuditType } from './audit-types';

/** One write, in the same shape whichever collection holds it. */
export interface AuditRecord {
  id: string;
  at: Date;
  actorId: string | null;
  type: string;
  action: string;
  objectId: string;
  changedFields: string[];
  comment: string;
}

export interface AuditFilter {
  actorId?: string;
  type?: AuditType;
  from?: Date;
  to?: Date;
  /** Only records older than this id. */
  before?: string;
}

/** Ids are UUIDv7 in both collections, so `_id` order is time order and the hex strings compare the same way. */
const NEWEST_FIRST = { _id: -1 } as const;
const byNewest = (left: AuditRecord, right: AuditRecord) =>
  left.id < right.id ? 1 : left.id > right.id ? -1 : 0;

const timeRange = ({ from, to }: AuditFilter) =>
  from || to
    ? { createdAt: { ...(from && { $gte: from }), ...(to && { $lt: to }) } }
    : {};

/**
 * The global change feed reads the two existing audit collections, `revisions` and `settingRevisions`, newest first.
 * Each is read on its own (`{userId|actor, _id}`, `{entity, _id}` or `_id` indexes) and the two pages are merged here,
 * because a `$unionWith` followed by a sort could use neither collection's index.
 */
@Injectable()
export class AuditFeedRepository {
  constructor(
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
    @InjectModel(SettingRevision.name)
    private readonly settingRevisions: Model<SettingRevision>,
  ) {}

  /** At most `limit` records, newest first. */
  async newest(filter: AuditFilter, limit: number): Promise<AuditRecord[]> {
    const reads: Promise<AuditRecord[]>[] = [];
    if (filter.type !== SETTING_TYPE)
      reads.push(this.revisionRecords(filter, limit));
    if (!filter.type || filter.type === SETTING_TYPE)
      reads.push(this.settingRecords(filter, limit));
    const records = (await Promise.all(reads)).flat();
    return records.sort(byNewest).slice(0, limit);
  }

  private async revisionRecords(
    filter: AuditFilter,
    limit: number,
  ): Promise<AuditRecord[]> {
    const query: FilterQuery<Revision> = {
      ...timeRange(filter),
      ...(filter.type && { entity: filter.type }),
      ...(filter.actorId && { userId: filter.actorId }),
      ...(filter.before && { _id: { $lt: filter.before } }),
    };
    const rows = await this.revisions
      .find(query)
      .sort(NEWEST_FIRST)
      .limit(limit)
      .lean<Revision[]>()
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      at: row.createdAt,
      actorId: row.userId ? uuidStr(row.userId) : null,
      type: row.entity,
      action: row.action,
      objectId: uuidStr(row.entityId),
      changedFields: Object.keys(row.changes ?? {}),
      comment: row.comment ?? '',
    }));
  }

  private async settingRecords(
    filter: AuditFilter,
    limit: number,
  ): Promise<AuditRecord[]> {
    const query: FilterQuery<SettingRevision> = {
      ...timeRange(filter),
      ...(filter.actorId && { actor: filter.actorId }),
      ...(filter.before && { _id: { $lt: filter.before } }),
    };
    const rows = await this.settingRevisions
      .find(query)
      .sort(NEWEST_FIRST)
      .limit(limit)
      .lean<SettingRevision[]>()
      .exec();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      at: row.createdAt,
      actorId: row.actor ? uuidStr(row.actor) : null,
      type: SETTING_TYPE,
      action: 'edit',
      objectId: row.key,
      changedFields: row.changedFields,
      comment: '',
    }));
  }
}
