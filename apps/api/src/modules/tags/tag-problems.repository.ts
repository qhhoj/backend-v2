import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CI, isUuid, Revision, TagProblem, uuidStr } from '@libs/database';
import type { TagAssignment } from '@libs/database';
import type { FilterQuery, HydratedDocument, Model } from 'mongoose';

export type TagProblemDocument = HydratedDocument<TagProblem>;

@Injectable()
export class TagProblemsRepository {
  constructor(
    @InjectModel(TagProblem.name)
    private readonly tagProblems: Model<TagProblem>,
    @InjectModel(Revision.name) private readonly revisions: Model<Revision>,
  ) {}

  findByCode(code: string): Promise<TagProblemDocument | null> {
    return this.tagProblems.findOne({ code }).collation(CI).exec();
  }

  findByIds(ids: readonly string[]): Promise<TagProblem[]> {
    const valid = ids.filter(isUuid);
    return valid.length
      ? this.tagProblems
          .find({ _id: { $in: valid } }, { tags: 0 })
          .lean<TagProblem[]>()
          .exec()
      : Promise.resolve([]);
  }

  async idByCode(code: string): Promise<string | null> {
    const row = await this.tagProblems
      .findOne({ code }, { _id: 1 })
      .collation(CI)
      .lean()
      .exec();
    return row ? uuidStr(row._id) : null;
  }

  async list(
    filter: FilterQuery<TagProblem>,
    page: number,
    pageSize: number,
  ): Promise<{ items: TagProblemDocument[]; total: number }> {
    const [items, total] = await Promise.all([
      this.tagProblems
        .find(filter)
        .collation(CI)
        .sort({ code: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.tagProblems.countDocuments(filter).collation(CI).exec(),
    ]);
    return { items, total };
  }

  create(fields: Partial<TagProblem>): Promise<TagProblemDocument> {
    return this.tagProblems.create(fields);
  }

  /** Atomic "add unless present": false when the tag was already on the problem (legacy `unique_together` + `IntegrityError: pass`). */
  async assign(id: string, assignment: TagAssignment): Promise<boolean> {
    const { matchedCount } = await this.tagProblems
      .updateOne(
        { _id: id, 'tags.tagId': { $ne: assignment.tagId } },
        { $push: { tags: assignment } },
      )
      .exec();
    return matchedCount === 1;
  }

  async appendRevision(
    entry: Pick<
      Revision,
      'entityId' | 'action' | 'userId' | 'changes' | 'comment'
    >,
  ): Promise<void> {
    await this.revisions.create({ entity: 'tagProblem', ...entry });
  }
}
