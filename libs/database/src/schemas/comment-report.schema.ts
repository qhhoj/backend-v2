import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { CommentPageRef, CommentPageRefSchema } from './comment.schema';

const UUID = MongooseSchema.Types.UUID;

export const COMMENT_REPORT_REASONS = [
  'spam',
  'abuse',
  'spoiler',
  'offTopic',
  'other',
] as const;
export type CommentReportReason = (typeof COMMENT_REPORT_REASONS)[number];

/** `open` until a moderator settles every open report of the comment at once. */
export const COMMENT_REPORT_STATUSES = [
  'open',
  'resolved',
  'dismissed',
] as const;
export type CommentReportStatus = (typeof COMMENT_REPORT_STATUSES)[number];

/** One user's report of one comment (new; legacy had none). `page` is copied so a page's removal drops its reports. */
@Schema({ ...baseSchemaOptions, collection: 'commentReports' })
export class CommentReport {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) comment!: string;
  @Prop({ type: CommentPageRefSchema, required: true }) page!: CommentPageRef;
  @Prop({ type: UUID, required: true }) reporter!: string;
  @Prop({ type: String, required: true, enum: [...COMMENT_REPORT_REASONS] })
  reason!: CommentReportReason;
  @Prop({ default: '', maxlength: 500 }) note!: string;
  @Prop({
    type: String,
    default: 'open',
    enum: [...COMMENT_REPORT_STATUSES],
  })
  status!: CommentReportStatus;
  @Prop({ type: UUID, default: null }) settledBy!: string | null;
  @Prop({ type: Date, default: null }) settledAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export const CommentReportSchema = SchemaFactory.createForClass(CommentReport);
// A user reports a comment once.
CommentReportSchema.index({ comment: 1, reporter: 1 }, { unique: true });
// The moderators' queue (open reports grouped by comment).
CommentReportSchema.index({ status: 1, comment: 1 });
// Removal with the page.
CommentReportSchema.index({ 'page.type': 1, 'page.id': 1 });
