import { Injectable } from '@nestjs/common';
import { unique } from '@libs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { HydratedDocument, Model } from 'mongoose';
import { subtreeFilter } from '@libs/community';
import type { CommentPage, CommentPageType } from '@libs/community';
import { Comment, isUuid, toUuid, uuidStr } from '@libs/database';

export type CommentDocument = HydratedDocument<Comment>;

@Injectable()
export class CommentsRepository {
  constructor(
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
  ) {}

  findById(id: string): Promise<CommentDocument | null> {
    return isUuid(id)
      ? this.comments.findById(id).exec()
      : Promise.resolve(null);
  }

  create(fields: Partial<Comment>): Promise<CommentDocument> {
    return this.comments.create(fields);
  }

  /** One page of visible roots, newest first, through `{page.type, page.id, hidden, parentId, _id}`. */
  async threads(
    page: CommentPage,
    pageNumber: number,
    pageSize: number,
  ): Promise<{ roots: Comment[]; total: number }> {
    const filter = {
      'page.type': page.type,
      'page.id': page.id,
      hidden: false,
      parentId: null,
    };
    const [roots, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ _id: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean<Comment[]>()
        .exec(),
      this.comments.countDocuments(filter).exec(),
    ]);
    return { roots, total };
  }

  /** Visible replies of the threads, in tree order, through `{threadId, hidden, path}`. The index is hinted (the planner otherwise sorts in memory over `{hidden, _id}`), and the roots are read along because a `parentId` filter would not use it. */
  async replies(threadIds: readonly string[]): Promise<Comment[]> {
    if (!threadIds.length) return [];
    const thread = await this.comments
      .find({ threadId: { $in: threadIds }, hidden: false })
      .sort({ path: 1 })
      .hint({ threadId: 1, hidden: 1, path: 1 })
      .lean<Comment[]>()
      .exec();
    return thread.filter((comment) => comment.parentId !== null);
  }

  /** Visible comments per page id of one type. */
  async countVisible(
    type: CommentPageType,
    ids: readonly string[],
  ): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.comments
      .aggregate<{ _id: unknown; count: number }>([
        {
          $match: {
            'page.type': type,
            'page.id': { $in: ids.map(toUuid) },
            hidden: false,
          },
        },
        { $group: { _id: '$page.id', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.count]));
  }

  /** Compare-and-set on the edit count: a concurrent edit makes this return false (409). */
  async updateBodyIfRevision(
    id: string,
    revisions: number,
    body: string,
    bodyHtml: string,
  ): Promise<boolean> {
    const result = await this.comments
      .updateOne(
        { _id: id, revisions },
        { $set: { body, bodyHtml }, $inc: { revisions: 1 } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** The comment at `path` and its descendants, through `{path}`; returns their distinct authors. */
  async setSubtreeHidden(path: string, hidden: boolean): Promise<string[]> {
    const filter = subtreeFilter(path);
    await this.comments.updateMany(filter, { $set: { hidden } }).exec();
    const authors: unknown[] = await this.comments
      .distinct('author', filter)
      .exec();
    return unique(authors.map(uuidStr));
  }

  async isHidden(id: string): Promise<boolean> {
    return (
      (await this.comments.exists({ _id: id, hidden: true }).exec()) !== null
    );
  }
}
