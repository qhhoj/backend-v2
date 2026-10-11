import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { Contest, ContestTag } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';
import type {
  CreateContestTagDto,
  UpdateContestTagDto,
} from './dto/contest-tag.dto';

@Injectable()
export class ContestTagsRepository {
  constructor(
    @InjectModel(ContestTag.name) private readonly tags: Model<ContestTag>,
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
  ) {}

  count(): Promise<number> {
    return this.tags.estimatedDocumentCount().exec();
  }

  async create(fields: CreateContestTagDto): Promise<ContestTag> {
    try {
      return (await this.tags.create(fields)).toObject();
    } catch (error) {
      if (isDuplicateKey(error))
        throw new AppError('conflict', 409, 'This tag already exists');
      throw error;
    }
  }

  /** Null when the slug is unknown. */
  updateBySlug(
    slug: string,
    changes: UpdateContestTagDto,
  ): Promise<ContestTag | null> {
    return this.tags
      .findOneAndUpdate({ slug }, { $set: changes }, { new: true })
      .lean<ContestTag>()
      .exec();
  }

  async deleteBySlug(slug: string): Promise<boolean> {
    const { deletedCount } = await this.tags.deleteOne({ slug }).exec();
    return deletedCount === 1;
  }

  /** For the deletion log line: contests that keep the slug and now show a neutral chip. */
  countContestsUsing(slug: string): Promise<number> {
    return this.contests.countDocuments({ tags: slug }).exec();
  }

  /** Per slug, how many contests matching `filter` carry it, in one aggregate (the filter is cast first, since `$match` does not cast ids). */
  async countsBySlug(
    filter: FilterQuery<Contest>,
  ): Promise<Map<string, number>> {
    const match: FilterQuery<Contest> = this.contests
      .find()
      .cast(this.contests, filter) as FilterQuery<Contest>;
    const rows = await this.contests
      .aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [row._id, row.count]));
  }

  countMatching(filter: FilterQuery<Contest>): Promise<number> {
    return this.contests.countDocuments(filter).exec();
  }
}
