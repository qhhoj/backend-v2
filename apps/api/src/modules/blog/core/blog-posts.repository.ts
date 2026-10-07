import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { FilterQuery, HydratedDocument, Model, SortOrder } from 'mongoose';
import { BlogPost, isUuid } from '@libs/database';

export type BlogPostDocument = HydratedDocument<BlogPost>;

/** List rows never carry the markdown sources. */
const LIST_PROJECTION = { content: 0, summary: 0 } as const;

@Injectable()
export class BlogPostsRepository {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
  ) {}

  findById(id: string): Promise<BlogPostDocument | null> {
    return isUuid(id) ? this.posts.findById(id).exec() : Promise.resolve(null);
  }

  findByIds(ids: readonly string[]): Promise<BlogPost[]> {
    return ids.length
      ? this.posts
          .find({ _id: { $in: ids } }, LIST_PROJECTION)
          .lean<BlogPost[]>()
          .exec()
      : Promise.resolve([]);
  }

  async page(
    filter: FilterQuery<BlogPost>,
    sort: Record<string, SortOrder>,
    page: number,
    pageSize: number,
  ): Promise<{ items: BlogPost[]; total: number }> {
    const [items, total] = await Promise.all([
      this.posts
        .find(filter, LIST_PROJECTION)
        .sort(sort)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<BlogPost[]>()
        .exec(),
      this.posts.countDocuments(filter).exec(),
    ]);
    return { items, total };
  }
}
