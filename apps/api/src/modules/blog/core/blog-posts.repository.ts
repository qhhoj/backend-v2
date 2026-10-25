import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type {
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
  SortOrder,
} from 'mongoose';
import { unique } from '@libs/common';
import {
  BlogPost,
  BlogVote,
  Comment,
  CommentLock,
  CommentPageCounter,
  CommentReport,
  CommentVote,
  isUuid,
  uuidStr,
} from '@libs/database';

export type BlogPostDocument = HydratedDocument<BlogPost>;

/** List rows never carry the markdown sources. */
const LIST_PROJECTION = { content: 0, summary: 0 } as const;

@Injectable()
export class BlogPostsRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(BlogVote.name) private readonly blogVotes: Model<BlogVote>,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(CommentVote.name)
    private readonly commentVotes: Model<CommentVote>,
    @InjectModel(CommentLock.name)
    private readonly commentLocks: Model<CommentLock>,
    @InjectModel(CommentReport.name)
    private readonly commentReports: Model<CommentReport>,
    @InjectModel(CommentPageCounter.name)
    private readonly commentCounters: Model<CommentPageCounter>,
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

  /** The first `limit` posts of a sort, without the total `page` also counts. */
  newest(
    filter: FilterQuery<BlogPost>,
    sort: Record<string, SortOrder>,
    limit: number,
  ): Promise<BlogPost[]> {
    return this.posts
      .find(filter, LIST_PROJECTION)
      .sort(sort)
      .limit(limit)
      .lean<BlogPost[]>()
      .exec();
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

  create(fields: Partial<BlogPost>): Promise<BlogPostDocument> {
    return this.posts.create(fields);
  }

  async update(id: string, changes: Partial<BlogPost>): Promise<void> {
    await this.posts.updateOne({ _id: id }, { $set: changes }).exec();
  }

  /** `update`, but only while no moderator has hidden the post; false when one has (so a stale read cannot make a moderator-hidden post public). */
  async updateUnlessModeratorHidden(
    id: string,
    changes: Partial<BlogPost>,
  ): Promise<boolean> {
    const { matchedCount } = await this.posts
      .updateOne(
        { _id: id, isHiddenByModerator: { $ne: true } },
        { $set: changes },
      )
      .exec();
    return matchedCount > 0;
  }

  /** The post and its discussion (votes, comments with their votes and reports, the lock, the numbering counter) in one transaction; legacy left the comments orphaned. Returns the comment authors, whose contribution points change. */
  async deleteWithDiscussion(id: string): Promise<string[]> {
    const page = { 'page.type': 'blog', 'page.id': id };
    let authors: string[] = [];
    await this.connection.transaction(async (session) => {
      const comments = await this.comments
        .find(page, { author: 1 }, { session })
        .lean()
        .exec();
      authors = unique(comments.map((row) => uuidStr(row.author)));
      await this.commentVotes
        .deleteMany(
          { comment: { $in: comments.map((row) => uuidStr(row._id)) } },
          { session },
        )
        .exec();
      await this.comments.deleteMany(page, { session }).exec();
      await this.commentLocks.deleteMany(page, { session }).exec();
      await this.commentReports.deleteMany(page, { session }).exec();
      await this.commentCounters.deleteMany(page, { session }).exec();
      await this.blogVotes.deleteMany({ blog: id }, { session }).exec();
      await this.posts.deleteOne({ _id: id }, { session }).exec();
    });
    return authors;
  }
}
