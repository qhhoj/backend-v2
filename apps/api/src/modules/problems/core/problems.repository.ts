import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CI,
  dataVersionIs,
  isUuid,
  Problem,
  toUuid,
  uuidStr,
} from '@libs/database';
import type { ProblemData, ProblemTranslation } from '@libs/database';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

export type ProblemDocument = HydratedDocument<Problem>;

/** List rows never carry statement or editorial bodies, nor test data. */
const LIST_PROJECTION = {
  data: 0,
  dataVersion: 0,
  description: 0,
  descriptionHtml: 0,
  summary: 0,
  'translations.description': 0,
  'translations.descriptionHtml': 0,
  'solution.content': 0,
  'solution.contentHtml': 0,
} as const;

const ACCESS_FIELDS = {
  isPublic: 1,
  isOrganizationPrivate: 1,
  organizations: 1,
  authors: 1,
  curators: 1,
  testers: 1,
  suggester: 1,
} as const;

/** A live problem: `deletedAt` is absent (never set, or restored). Every finder that discovers problems spreads this in. */
const LIVE = { deletedAt: null } as const;
/** A problem in its grace period, or a tombstone. A range (not `$ne: null`) so the sparse `{deletedAt: 1}` index serves it. */
const DELETED = { deletedAt: { $gt: new Date(0) } } as const;

const RANDOM_ATTEMPTS = 2;

@Injectable()
export class ProblemsRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  findByCode(code: string): Promise<ProblemDocument | null> {
    return this.problems.findOne({ code, ...LIVE }).exec();
  }

  /** `data` is `select: false` (it can hold thousands of cases); only the data editor loads it. */
  findByCodeWithData(code: string): Promise<ProblemDocument | null> {
    return this.problems
      .findOne({ code, ...LIVE })
      .select('+data')
      .exec();
  }

  /** Test cases of a problem the caller already resolved (`C` rows: batch members included, `S`/`E` markers not), counted in the database so the 10000-row array never loads; it follows an id, so it does not filter. */
  async caseCount(problemId: string): Promise<number> {
    const [row] = await this.problems.aggregate<{ count: number }>([
      { $match: { _id: toUuid(problemId) } },
      {
        $project: {
          count: {
            $size: {
              $filter: {
                input: { $ifNull: ['$data.cases', []] },
                cond: { $eq: ['$$this.type', 'C'] },
              },
            },
          },
        },
      },
    ]);
    return row?.count ?? 0;
  }

  findById(id: string): Promise<ProblemDocument | null> {
    return this.problems.findOne({ _id: id, ...LIVE }).exec();
  }

  /** The flags that put a problem's submissions on the public feed. */
  findPublicity(
    id: string,
  ): Promise<Pick<Problem, 'isPublic' | 'isOrganizationPrivate'> | null> {
    return this.problems
      .findOne({ _id: id, ...LIVE }, { isPublic: 1, isOrganizationPrivate: 1 })
      .lean<Pick<Problem, 'isPublic' | 'isOrganizationPrivate'>>()
      .exec();
  }

  /** Only the fields `ProblemAccess.accessView` reads: no statement, no data. */
  findForAccess(id: string): Promise<ProblemDocument | null> {
    return isUuid(id)
      ? this.problems.findOne({ _id: id, ...LIVE }, ACCESS_FIELDS).exec()
      : Promise.resolve(null);
  }

  /** `findForAccess` by code. */
  findForAccessByCode(code: string): Promise<ProblemDocument | null> {
    return this.problems.findOne({ code, ...LIVE }, ACCESS_FIELDS).exec();
  }

  async list(
    filter: FilterQuery<Problem>,
    sort: Record<string, 1 | -1>,
    page: number,
    pageSize: number,
  ): Promise<{ items: ProblemDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.findPage(filter, sort, page, pageSize),
      this.count(filter),
    ]);
    return { items, total };
  }

  findPage(
    filter: FilterQuery<Problem>,
    sort: Record<string, 1 | -1>,
    page: number,
    pageSize: number,
  ): Promise<ProblemDocument[]> {
    return this.problems
      .find({ ...filter, ...LIVE }, LIST_PROJECTION)
      .collation(CI)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .exec();
  }

  /** Code of one uniformly random live problem matching `filter`: count, then a random offset (a `$sample` aggregate would skip the UUID casting `find` does on the filter). The set may shrink between the two queries, so a miss on a non-empty set is retried once. */
  async randomCode(filter: FilterQuery<Problem>): Promise<string | null> {
    for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
      const total = await this.count(filter);
      if (!total) return null;
      const [picked] = await this.problems
        .find({ ...filter, ...LIVE }, { code: 1 })
        .collation(CI)
        .sort({ _id: 1 })
        .skip(Math.floor(Math.random() * total))
        .limit(1)
        .lean()
        .exec();
      if (picked) return picked.code;
    }
    return null;
  }

  count(filter: FilterQuery<Problem>): Promise<number> {
    return this.problems
      .countDocuments({ ...filter, ...LIVE })
      .collation(CI)
      .exec();
  }

  create(fields: Partial<Problem>): Promise<ProblemDocument> {
    return this.problems.create(fields);
  }

  async update(id: string, changes: Partial<Problem>): Promise<void> {
    await this.problems.updateOne({ _id: id }, { $set: changes }).exec();
  }

  /** Makes the editorial public from `now` unless it is already released; false when it is missing or another writer released it first. */
  async releaseSolution(id: string, now: Date): Promise<boolean> {
    const { modifiedCount } = await this.problems
      .updateOne(
        {
          _id: id,
          solution: { $ne: null },
          $or: [
            { 'solution.isPublic': false },
            { 'solution.publishOn': { $gt: now } },
          ],
        },
        { $set: { 'solution.isPublic': true, 'solution.publishOn': now } },
      )
      .exec();
    return modifiedCount === 1;
  }

  /** Compare-and-set on `dataVersion`; false when another writer got there first. A missing counter counts as 0. */
  async updateData(
    id: string,
    code: string,
    expectedVersion: number,
    data: ProblemData,
  ): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        {
          _id: id,
          code,
          dataVersion: dataVersionIs(expectedVersion),
        },
        { $set: { data }, $inc: { dataVersion: 1 } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Other problems still pointing at an uploaded file (clones copy the urls). Deleted problems count: a restorable problem still owns its upload, so this is S. */
  countOtherReferences(
    field: 'pdfStatementUrl' | 'materialUrl',
    url: string,
    excludedId: string,
  ): Promise<number> {
    return this.problems
      .countDocuments({ [field]: url, _id: { $ne: excludedId } })
      .exec();
  }

  /** Appends the translation unless its language exists (atomic guard), otherwise replaces it. */
  async upsertTranslation(
    id: string,
    translation: ProblemTranslation,
  ): Promise<void> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: id, 'translations.language': { $ne: translation.language } },
        { $push: { translations: translation } },
      )
      .exec();
    if (matchedCount === 0)
      await this.problems
        .updateOne(
          { _id: id, 'translations.language': translation.language },
          { $set: { 'translations.$': translation } },
        )
        .exec();
  }

  /** Ids of the live problems matching `filter` (a `ProblemAccess.visibleFilter`), for submission lists. */
  async visibleIds(filter: FilterQuery<Problem>): Promise<string[]> {
    return (
      await this.problems.distinct('_id', { ...filter, ...LIVE }).exec()
    ).map(uuidStr);
  }

  findSummaries(ids: string[]): Promise<ProblemDocument[]> {
    return this.problems
      .find({ _id: { $in: ids }, ...LIVE }, { code: 1, name: 1 })
      .exec();
  }

  /** List rows (no statement, editorial body or data); unknown, deleted and malformed ids are skipped. */
  findByIds(ids: readonly string[]): Promise<ProblemDocument[]> {
    const valid = ids.filter(isUuid);
    return valid.length
      ? this.problems
          .find({ _id: { $in: valid }, ...LIVE }, LIST_PROJECTION)
          .exec()
      : Promise.resolve([]);
  }

  async idByCode(code: string): Promise<string | null> {
    const row = await this.problems
      .findOne({ code, ...LIVE }, { _id: 1 })
      .lean()
      .exec();
    return row ? uuidStr(row._id) : null;
  }

  // --- Deliberately S: they see deleted problems and tombstones. Callers say why. ---

  /** The staff restore and purge routes: a problem in its grace period or a tombstone, by code. */
  findDeletedByCode(code: string): Promise<ProblemDocument | null> {
    return this.problems.findOne({ code, ...DELETED }).exec();
  }

  /** A submission's problem, deleted or not: history must keep rendering. Callers decide who may see it. */
  findIncludingDeleted(id: string): Promise<ProblemDocument | null> {
    return isUuid(id)
      ? this.problems.findById(id).exec()
      : Promise.resolve(null);
  }

  /** Names for submission rows, deleted problems included. */
  findSummariesIncludingDeleted(ids: string[]): Promise<ProblemDocument[]> {
    return this.problems
      .find(
        { _id: { $in: ids } },
        { code: 1, name: 1, deletedAt: 1, purgedAt: 1 },
      )
      .exec();
  }

  /** The deleted list: problems in their grace period or tombstoned that match `filter` (a `ProblemAccess.visibleFilter`), newest deletion first. */
  async deletedPage(
    filter: FilterQuery<Problem>,
    page: number,
    pageSize: number,
  ): Promise<{ items: ProblemDocument[]; total: number }> {
    const where = { ...filter, ...DELETED };
    const [items, total] = await Promise.all([
      this.problems
        .find(where, LIST_PROJECTION)
        .sort({ deletedAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.problems.countDocuments(where).exec(),
    ]);
    return { items, total };
  }

  /** Every deleted problem's id (tombstones included), used to scope submission lists. One `distinct` over the sparse `deletedAt` index per list call, not cached: a cache would keep a just-deleted problem's submissions in other users' lists until it expired. The set grows by one id per purged problem; revisit with a short cache plus event invalidation if lists get slow. */
  async deletedIds(): Promise<string[]> {
    return (await this.problems.distinct('_id', DELETED).exec()).map(uuidStr);
  }

  /** False when it was already deleted (or is gone): the guard makes a double delete a no-op. */
  async markDeleted(id: string, actorId: string, now: Date): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: id, ...LIVE },
        { $set: { deletedAt: now, deletedBy: actorId } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** False when the problem is live, unknown, or a purge has claimed it (`purgeStartedAt`) or finished it (`purgedAt`): a half-purged problem cannot come back either. */
  async restore(id: string): Promise<boolean> {
    const { matchedCount } = await this.problems
      .updateOne(
        { _id: id, ...DELETED, purgeStartedAt: null, purgedAt: null },
        { $unset: { deletedAt: '', deletedBy: '' } },
      )
      .exec();
    return matchedCount === 1;
  }

  /** Recompute-and-set: the size of the problem's data directory, written after every data write and by the backfill job. */
  async setDataBytes(id: string, bytes: number): Promise<void> {
    await this.problems
      .updateOne({ _id: id }, { $set: { dataBytes: bytes } })
      .exec();
  }

  async sumDataBytes(organizationId: string): Promise<number> {
    const sums = await this.sumDataBytesByOrganization([organizationId]);
    return sums.get(organizationId) ?? 0;
  }

  /** Bytes per organization over its private problems, grouped by the FIRST listed organization (the one charged). Deleted-but-not-purged problems count (the data is still on disk); a purged tombstone holds none. Organizations with nothing are absent from the map. */
  async sumDataBytesByOrganization(
    organizationIds: readonly string[],
  ): Promise<Map<string, number>> {
    const ids = organizationIds.map(toUuid);
    const rows = await this.problems.aggregate<{ _id: unknown; bytes: number }>(
      [
        {
          $match: {
            isOrganizationPrivate: true,
            purgedAt: null,
            organizations: { $in: ids },
          },
        },
        {
          $group: {
            _id: { $arrayElemAt: ['$organizations', 0] },
            bytes: { $sum: '$dataBytes' },
          },
        },
        { $match: { _id: { $in: ids } } },
      ],
    );
    return new Map(rows.map((row) => [uuidStr(row._id as string), row.bytes]));
  }
}
