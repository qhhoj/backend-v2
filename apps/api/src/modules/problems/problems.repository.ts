import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, Problem } from '@libs/database';
import type { ProblemTranslation } from '@libs/database';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

export type ProblemDocument = HydratedDocument<Problem>;

/** List rows never carry statement or editorial bodies. */
const LIST_PROJECTION = {
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

  findById(id: string): Promise<ProblemDocument | null> {
    return this.problems.findById(id).exec();
  }

  async list(
    filter: FilterQuery<Problem>,
    sort: Record<string, 1 | -1>,
    page: number,
    pageSize: number,
  ): Promise<{ items: ProblemDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.problems
        .find(filter, LIST_PROJECTION)
        .collation(CI)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.problems.countDocuments(filter).collation(CI).exec(),
    ]);
    return { items, total };
  }

  create(fields: Partial<Problem>): Promise<ProblemDocument> {
    return this.problems.create(fields);
  }

  async update(id: string, changes: Partial<Problem>): Promise<void> {
    await this.problems.updateOne({ _id: id }, { $set: changes }).exec();
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
}
