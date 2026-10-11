import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Legacy page prefixes `p:`, `s:`, `c:`, `b:`, `t:`. */
export const COMMENT_PAGE_TYPES = [
  'problem',
  'editorial',
  'contest',
  'blog',
  'tagProblem',
] as const;
export type CommentPageType = (typeof COMMENT_PAGE_TYPES)[number];

/** The commented entity by id (a problem for `problem` and `editorial`), so a rename never orphans a thread. */
@Schema({ _id: false })
export class CommentPageRef {
  @Prop({ type: String, required: true, enum: [...COMMENT_PAGE_TYPES] })
  type!: CommentPageType;
  @Prop({ type: UUID, required: true }) id!: string;
}
export const CommentPageRefSchema =
  SchemaFactory.createForClass(CommentPageRef);

/** Legacy MPTT `Comment` as a materialized path: `path` is the ancestors' ids and its own, joined by `/`; `threadId` is the root's id. */
@Schema({ ...baseSchemaOptions, collection: 'comments' })
export class Comment {
  @IdProp() _id!: string;
  @Prop({ type: CommentPageRefSchema, required: true }) page!: CommentPageRef;
  @Prop({ type: UUID, required: true }) author!: string;
  @Prop({ type: UUID, default: null }) parentId!: string | null;
  @Prop({ type: UUID, required: true }) threadId!: string;
  @Prop({ required: true }) path!: string;
  @Prop({ required: true, minlength: 1, maxlength: 8192 }) body!: string;
  /** `body` rendered at save in the `user` style. */
  @Prop({ default: '' }) bodyHtml!: string;
  /** Sum of the votes; moved only inside a vote's transaction. */
  @Prop({ default: 0 }) score!: number;
  @Prop({ default: false }) hidden!: boolean;
  /** The comment whose hide hid this one (itself for a direct hide, an ancestor for a subtree hide); null while visible. Unhiding a comment clears only the rows it hid. Legacy hidden comments migrate with `hiddenBy` = their own id. */
  @Prop({ type: UUID, default: null }) hiddenBy!: string | null;
  /** The moderator whose hide hid this row; null while visible and for hides migrated from the old site. */
  @Prop({ type: UUID, default: null }) hiddenByUser!: string | null;
  /** Soft delete: `body` becomes `COMMENT_DELETED_BODY` and `bodyHtml` empty, the row stays so replies keep their context. Null (or missing on older rows) while live. */
  @Prop({ type: Date, default: null }) deletedAt!: Date | null;
  /** Who deleted it: the author or a moderator. */
  @Prop({ type: UUID, default: null }) deletedBy!: string | null;
  /** 1-based position on its page in posting order, from `commentPageCounters`. */
  @Prop({ type: Number, default: null }) number!: number | null;
  /** Edits so far; the compare-and-set token of an edit. */
  @Prop({ default: 0, min: 0 }) revisions!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);
// A page's threads (roots, newest first) and its visible count.
CommentSchema.index({
  'page.type': 1,
  'page.id': 1,
  hidden: 1,
  parentId: 1,
  _id: -1,
});
// The replies of the threads on one page of roots, in tree order.
CommentSchema.index({ threadId: 1, hidden: 1, path: 1 });
// Hide/unhide of a subtree (anchored prefix of `path`).
CommentSchema.index({ path: 1 });
// Recent comments (homepage, feed).
CommentSchema.index({ hidden: 1, _id: -1 });
// A user's comments (tab, contribution sum, export).
CommentSchema.index({ author: 1, hidden: 1, _id: -1 });
