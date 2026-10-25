import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Legacy `BlogPost`. `organization` null: a personal or site post; set: visible only to that organization's members (and editors). */
@Schema({ ...baseSchemaOptions, collection: 'blogPosts' })
export class BlogPost {
  @IdProp() _id!: string;
  @Prop({ required: true, minlength: 1, maxlength: 100 }) title!: string;
  /** Cosmetic (routes use the id): the author's username or the organization slug, legacy. */
  @Prop({ required: true, maxlength: 128 }) slug!: string;
  @Prop({ type: [UUID], default: [] }) authors!: string[];
  @Prop({ type: UUID, default: null }) organization!: string | null;
  /** Authors self-publish (legacy). */
  @Prop({ default: false }) visible!: boolean;
  /** Set when `judge.edit_all_post` hides a post it does not author; while set, only `judge.edit_all_post` makes the post visible again. */
  @Prop({ default: false }) isHiddenByModerator!: boolean;
  @Prop({ default: false }) sticky!: boolean;
  /** Shown on the homepage newsfeed. */
  @Prop({ default: false }) globalPost!: boolean;
  @Prop({ type: Date, required: true }) publishOn!: Date;
  @Prop({ required: true }) content!: string;
  @Prop({ default: '' }) contentHtml!: string;
  @Prop({ default: '' }) summary!: string;
  @Prop({ default: '' }) summaryHtml!: string;
  @Prop({ default: '', maxlength: 150 }) ogImage!: string;
  /** Sum of the votes; moved only inside a vote's transaction. */
  @Prop({ default: 0 }) score!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);
// Every list sorts by `_id: -1` last, so the index orders ties and no query sorts in memory.
// Homepage newsfeed: personal, visible, global posts, sticky first.
BlogPostSchema.index({
  organization: 1,
  visible: 1,
  globalPost: 1,
  sticky: -1,
  publishOn: -1,
  _id: -1,
});
// All posts and the blog feed, newest first.
BlogPostSchema.index({ organization: 1, visible: 1, publishOn: -1, _id: -1 });
// An organization's posts, sticky first.
BlogPostSchema.index({
  organization: 1,
  visible: 1,
  sticky: -1,
  publishOn: -1,
  _id: -1,
});
// Moderation lists: hidden drafts, and scheduled posts (visible, publishing later).
BlogPostSchema.index({ visible: 1, publishOn: -1, _id: -1 });
// A user's blog tab and their contribution sum.
BlogPostSchema.index({
  authors: 1,
  organization: 1,
  sticky: -1,
  publishOn: -1,
  _id: -1,
});
// A writer's drafts and scheduled posts, newest publish time first.
BlogPostSchema.index({ authors: 1, publishOn: -1, _id: -1 });
