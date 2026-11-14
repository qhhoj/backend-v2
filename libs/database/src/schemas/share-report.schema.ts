import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { COMMENT_REPORT_STATUSES } from './comment-report.schema';
import type { CommentReportStatus } from './comment-report.schema';

const UUID = MongooseSchema.Types.UUID;

/** `contest`: the link leaks a solution of a running contest. */
export const SHARE_REPORT_REASONS = [
  'spam',
  'abuse',
  'contest',
  'other',
] as const;
export type ShareReportReason = (typeof SHARE_REPORT_REASONS)[number];
/** Reports outlive their share at most this long. */
export const SHARE_REPORT_RETENTION_SECONDS = 180 * 24 * 60 * 60;

/** One user's report of one share, the comment-report pattern: `open` until staff settle every open report of the code at once, share gone or not. */
@Schema({ ...baseSchemaOptions, collection: 'shareReports' })
export class ShareReport {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) share!: string;
  /** The share's code, kept so its reports can be settled after the share expires or is deleted. */
  @Prop({ required: true }) code!: string;
  @Prop({ type: UUID, required: true }) reporter!: string;
  @Prop({ type: String, required: true, enum: [...SHARE_REPORT_REASONS] })
  reason!: ShareReportReason;
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

export const ShareReportSchema = SchemaFactory.createForClass(ShareReport);
// A user reports a share once.
ShareReportSchema.index({ share: 1, reporter: 1 }, { unique: true });
// Settling a code's open reports.
ShareReportSchema.index({ code: 1, status: 1 });
// The staff queue.
ShareReportSchema.index({ status: 1, _id: -1 });
// Reports of an expired or deleted share do not linger.
ShareReportSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: SHARE_REPORT_RETENTION_SECONDS },
);
