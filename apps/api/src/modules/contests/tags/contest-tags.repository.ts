import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AppError, isDuplicateKey } from '@libs/common';
import { Contest, ContestTag } from '@libs/database';
import type { Model } from 'mongoose';
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
}
