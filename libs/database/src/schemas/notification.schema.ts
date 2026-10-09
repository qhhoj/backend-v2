import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const NOTIFICATION_KINDS = [
  'ticket-message',
  'ticket-status',
  'ticket-new',
  'contest-announcement',
  'organization-request-decided',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export const NOTIFICATION_PRIORITIES = ['normal', 'high'] as const;
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_TITLE_MAX = 100;
export const NOTIFICATION_BODY_MAX = 200;
export const NOTIFICATION_PATH_MAX = 200;
/** An internal path only: the `(?!/)` lookahead refuses `//host`, and `\`, `:` and spaces are not allowed. */
export const NOTIFICATION_PATH_PATTERN = /^\/(?!\/)[A-Za-z0-9/_\-.?=&%]*$/;

/** A short pointer in a user's inbox. At most one unread row per user and `groupKey`: a repeated event merges into it. */
@Schema({
  ...baseSchemaOptions,
  collection: 'notifications',
  timestamps: false,
})
export class Notification {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: String, required: true, enum: [...NOTIFICATION_KINDS] })
  kind!: NotificationKind;
  @Prop({ required: true, maxlength: NOTIFICATION_TITLE_MAX }) title!: string;
  /** Plain text. */
  @Prop({ default: '', maxlength: NOTIFICATION_BODY_MAX }) body!: string;
  @Prop({
    required: true,
    maxlength: NOTIFICATION_PATH_MAX,
    match: NOTIFICATION_PATH_PATTERN,
  })
  path!: string;
  @Prop({ type: String, enum: [...NOTIFICATION_PRIORITIES], default: 'normal' })
  priority!: NotificationPriority;
  /** What merges: `ticket:<id>`, `contest-ann:<contestId>`, `org-request:<id>`. */
  @Prop({ required: true, maxlength: 100 }) groupKey!: string;
  /** Events merged into this row. */
  @Prop({ default: 1, min: 1 }) count!: number;
  @Prop({ default: true }) unread!: boolean;
  @Prop({ type: Date, default: null }) readAt!: Date | null;
  /** The announcement id last merged by the fan-out job: makes a retried job a no-op. */
  @Prop({ type: String, default: null, maxlength: 64 }) lastRef!: string | null;
  /** Lists order by this, not by `_id`: a merge moves the row to the top. */
  @Prop({ type: Date, required: true }) lastActivityAt!: Date;
  @Prop({ type: Date, required: true }) createdAt!: Date;
  /** `lastActivityAt` + 90 days; the TTL index removes the row. */
  @Prop({ type: Date, required: true }) expiresAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
// All rows, newest activity first (`_id` breaks ties, so the page needs no sort stage).
NotificationSchema.index({ user: 1, lastActivityAt: -1, _id: -1 });
// Unread and read lists, the unread count and the high-priority banner.
NotificationSchema.index({ user: 1, unread: 1, lastActivityAt: -1, _id: -1 });
// One unread row per user and group: the merge target.
NotificationSchema.index(
  { user: 1, groupKey: 1 },
  { unique: true, partialFilterExpression: { unread: true } },
);
// The nightly trim visits users with recent activity.
NotificationSchema.index({ lastActivityAt: -1 });
// Retention.
NotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
