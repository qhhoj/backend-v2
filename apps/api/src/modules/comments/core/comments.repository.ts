import { Injectable } from '@nestjs/common';
import { isDuplicateKey, unique } from '@libs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import type {
  ClientSession,
  Connection,
  FilterQuery,
  HydratedDocument,
  Model,
} from 'mongoose';
import { COMMENT_DELETED_BODY, subtreeFilter } from '@libs/community';
import type { CommentPage, CommentPageType } from '@libs/community';
import {
  Comment,
  CommentPageCounter,
  isUuid,
  toUuid,
  uuidStr,
} from '@libs/database';

/** A moderator's search never holds the database longer than this. */
const SEARCH_TIME_LIMIT_MS = 5000;

export type CommentDocument = HydratedDocument<Comment>;

/** Visible rows only, or (for moderators) hidden ones too; `$in` keeps `hidden` an index key so the same indexes serve both. */
const hiddenFilter = (includeHidden: boolean) =>
  includeHidden ? { hidden: { $in: [false, true] } } : { hidden: false };

const pageFilter = (page: CommentPage) => ({
  'page.type': page.type,
  'page.id': page.id,
});

@Injectable()
export class CommentsRepository {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Comment.name) private readonly comments: Model<Comment>,
    @InjectModel(CommentPageCounter.name)
    private readonly counters: Model<CommentPageCounter>,
  ) {}

  findById(id: string): Promise<CommentDocument | null> {
    return isUuid(id)
      ? this.comments.findById(id).exec()
      : Promise.resolve(null);
  }

  findByIds(ids: readonly string[]): Promise<Comment[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.comments
      .find({ _id: { $in: ids } })
      .lean<Comment[]>()
      .exec();
  }

  create(fields: Partial<Comment>): Promise<CommentDocument> {
    return this.comments.create(fields);
  }

  /** Newest visible, undeleted comments (optionally one author's), older than `before`, through `{hidden, _id}` or `{author, hidden, _id}`. */
  newestVisible(
    { authorId, before }: { authorId?: string; before?: string | null },
    limit: number,
  ): Promise<Comment[]> {
    return this.comments
      .find({
        hidden: false,
        deletedAt: null,
        ...(authorId ? { author: authorId } : {}),
        ...(before ? { _id: { $lt: before } } : {}),
      })
      .sort({ _id: -1 })
      .limit(limit)
      .lean<Comment[]>()
      .exec();
  }

  /** One page of roots (deleted ones included, as placeholders), newest first, through `{page.type, page.id, hidden, parentId, _id}`. */
  async threads(
    page: CommentPage,
    pageNumber: number,
    pageSize: number,
    includeHidden: boolean,
  ): Promise<{ roots: Comment[]; total: number }> {
    const filter = {
      ...pageFilter(page),
      ...hiddenFilter(includeHidden),
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

  /** Roots of the page listed before `rootId` (newer ones) under the same filter as `threads`: its page is this count / page size + 1. */
  rootsNewerThan(
    page: CommentPage,
    rootId: string,
    includeHidden: boolean,
  ): Promise<number> {
    return this.comments
      .countDocuments({
        ...pageFilter(page),
        ...hiddenFilter(includeHidden),
        parentId: null,
        _id: { $gt: rootId },
      })
      .exec();
  }

  /** The first `limit` replies of a thread in tree order (a prefix, so every listed reply's parent is listed) and whether more exist, through `{threadId, hidden, path}`. The index is hinted (the planner otherwise sorts in memory over `{hidden, _id}`), and the root is read along because a `parentId` filter would not use it. */
  async replies(
    threadId: string,
    includeHidden: boolean,
    limit: number,
  ): Promise<{ replies: Comment[]; truncated: boolean }> {
    const thread = await this.comments
      .find({ threadId, ...hiddenFilter(includeHidden) })
      .sort({ path: 1 })
      .hint({ threadId: 1, hidden: 1, path: 1 })
      .limit(limit + 2)
      .lean<Comment[]>()
      .exec();
    const replies = thread.filter((comment) => comment.parentId !== null);
    return {
      replies: replies.slice(0, limit),
      truncated: replies.length > limit,
    };
  }

  /** Visible, undeleted comments per page id of one type. */
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
            deletedAt: null,
          },
        },
        { $group: { _id: '$page.id', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [uuidStr(row._id), row.count]));
  }

  /** One page of any comments (hidden and deleted ones too) matching `filter`, newest first; a body search scans, so it is bounded by `maxTimeMS`. */
  async newestMatching(
    filter: FilterQuery<Comment>,
    pageNumber: number,
    pageSize: number,
  ): Promise<{ items: Comment[]; total: number }> {
    const [items, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ _id: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .maxTimeMS(SEARCH_TIME_LIMIT_MS)
        .lean<Comment[]>()
        .exec(),
      this.comments
        .countDocuments(filter)
        .maxTimeMS(SEARCH_TIME_LIMIT_MS)
        .exec(),
    ]);
    return { items, total };
  }

  /** Compare-and-set on the edit count: a concurrent edit makes this return false (409). */
  async updateBodyIfRevision(
    id: string,
    revisions: number,
    { body, bodyHtml }: { body: string; bodyHtml: string },
    session?: ClientSession,
  ): Promise<boolean> {
    const { modifiedCount } = await this.comments
      .updateOne(
        { _id: id, revisions },
        { $set: { body, bodyHtml }, $inc: { revisions: 1 } },
        { session },
      )
      .exec();
    return modifiedCount === 1;
  }

  /** Hides the comment at `path` and the visible descendants (through `{path}`), recording `hiddenBy` (and the moderator, `hiddenByUser`) on each; returns the subtree's distinct authors. Rows already hidden keep their own `hiddenBy`, so the hide of an ancestor never takes them over. */
  async hideSubtree(
    path: string,
    hiddenBy: string,
    hiddenByUser: string | null,
  ): Promise<string[]> {
    await this.comments
      .updateMany(
        { ...subtreeFilter(path), hidden: false },
        { $set: { hidden: true, hiddenBy, hiddenByUser } },
      )
      .exec();
    return this.subtreeAuthors(path);
  }

  /** Unhides only the rows `hiddenBy` hid (through `{path}`): comments hidden on their own stay hidden. Returns the subtree's distinct authors. */
  async unhideSubtree(path: string, hiddenBy: string): Promise<string[]> {
    await this.comments
      .updateMany(
        { $and: [subtreeFilter(path), { hiddenBy }] },
        { $set: { hidden: false, hiddenBy: null, hiddenByUser: null } },
      )
      .exec();
    return this.subtreeAuthors(path);
  }

  private async subtreeAuthors(path: string): Promise<string[]> {
    const authors: unknown[] = await this.comments
      .distinct('author', subtreeFilter(path))
      .exec();
    return unique(authors.map(uuidStr));
  }

  /** Soft delete; false when the row was already deleted (a concurrent delete). */
  async softDelete(id: string, deletedBy: string, now: Date): Promise<boolean> {
    const { modifiedCount } = await this.comments
      .updateOne(
        { _id: id, deletedAt: null },
        {
          $set: {
            body: COMMENT_DELETED_BODY,
            bodyHtml: '',
            deletedAt: now,
            deletedBy,
          },
        },
      )
      .exec();
    return modifiedCount === 1;
  }

  /** The page's next `number`. A page without a counter is seeded with its comment count first (rows posted before numbering, numbered 1..count by the backfill); racing seeds collide on the unique page key and the loser just increments. */
  async nextNumber(page: CommentPage): Promise<number> {
    const bumped = await this.bumpCounter(page);
    if (bumped !== null) return bumped;
    const seq = await this.comments.countDocuments(pageFilter(page)).exec();
    try {
      await this.counters.create({ page, seq });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
    return (await this.bumpCounter(page))!;
  }

  private async bumpCounter(page: CommentPage): Promise<number | null> {
    const counter = await this.counters
      .findOneAndUpdate(
        pageFilter(page),
        { $inc: { seq: 1 } },
        { new: true, projection: { seq: 1 } },
      )
      .lean<{ seq: number }>()
      .exec();
    return counter ? counter.seq : null;
  }

  /** Writes that must commit together (an edit and its revision row). */
  inTransaction(
    work: (session: ClientSession) => Promise<void>,
  ): Promise<void> {
    return this.connection.transaction(work).then(() => undefined);
  }

  /** The hide that hid `id`: the comment it was hidden with and the moderator; null when `id` is visible. */
  async hiddenBy(
    id: string,
  ): Promise<{ commentId: string; userId: string | null } | null> {
    const row = await this.comments
      .findOne({ _id: id, hidden: true }, { hiddenBy: 1, hiddenByUser: 1 })
      .lean<{ hiddenBy: unknown; hiddenByUser?: unknown }>()
      .exec();
    if (!row) return null;
    return {
      commentId: row.hiddenBy ? uuidStr(row.hiddenBy) : id,
      userId: row.hiddenByUser ? uuidStr(row.hiddenByUser) : null,
    };
  }
}
