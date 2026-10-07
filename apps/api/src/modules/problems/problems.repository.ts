import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, dataVersionIs, Problem, uuidStr } from '@libs/database';
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

@Injectable()
export class ProblemsRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  findByCode(code: string): Promise<ProblemDocument | null> {
    return this.problems.findOne({ code }).exec();
  }

  /** `data` is `select: false` (it can hold thousands of cases); only the data editor loads it. */
  findByCodeWithData(code: string): Promise<ProblemDocument | null> {
    return this.problems.findOne({ code }).select('+data').exec();
  }

  findById(id: string): Promise<ProblemDocument | null> {
    return this.problems.findById(id).exec();
  }

  /** The flags that put a problem's submissions on the public feed. */
  findPublicity(
    id: string,
  ): Promise<Pick<Problem, 'isPublic' | 'isOrganizationPrivate'> | null> {
    return this.problems
      .findById(id, { isPublic: 1, isOrganizationPrivate: 1 })
      .lean<Pick<Problem, 'isPublic' | 'isOrganizationPrivate'>>()
      .exec();
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
      .find(filter, LIST_PROJECTION)
      .collation(CI)
      .sort(sort)
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .exec();
  }

  count(filter: FilterQuery<Problem>): Promise<number> {
    return this.problems.countDocuments(filter).collation(CI).exec();
  }

  create(fields: Partial<Problem>): Promise<ProblemDocument> {
    return this.problems.create(fields);
  }

  async update(id: string, changes: Partial<Problem>): Promise<void> {
    await this.problems.updateOne({ _id: id }, { $set: changes }).exec();
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

  /** Other problems still pointing at an uploaded file (clones copy the urls). */
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

  /** Ids of the problems matching `filter` (a `ProblemAccess.visibleFilter`), for submission lists. */
  async visibleIds(filter: FilterQuery<Problem>): Promise<string[]> {
    return (await this.problems.distinct('_id', filter).exec()).map(uuidStr);
  }

  findSummaries(ids: string[]): Promise<ProblemDocument[]> {
    return this.problems
      .find({ _id: { $in: ids } }, { code: 1, name: 1 })
      .exec();
  }

  findByIds(ids: string[]): Promise<ProblemDocument[]> {
    return this.problems.find({ _id: { $in: ids } }).exec();
  }
}
