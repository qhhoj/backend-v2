import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** `frozen-until-release`: the feed stops at the freeze until an editor releases it; `live`: no cut, an explicit opt-in. */
export const FEED_KEY_MODES = ['frozen-until-release', 'live'] as const;
export type FeedKeyMode = (typeof FEED_KEY_MODES)[number];

/** The key itself is never stored, only its sha256. The newest key of a contest is the only one accepted. */
@Schema({ ...baseSchemaOptions, collection: 'contestFeedKeys' })
export class ContestFeedKey {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ required: true, match: SHA256_HEX }) keyHash!: string;
  @Prop({ type: String, default: 'frozen-until-release', enum: FEED_KEY_MODES })
  mode!: FeedKeyMode;
  /** The editor who minted it; the key stops working when this user can no longer edit the contest. */
  @Prop({ type: UUID, required: true }) createdBy!: string;
  @Prop({ type: Date, required: true }) expiresAt!: Date;
  @Prop({ type: Date, default: null }) revokedAt!: Date | null;
  /** "Release to resolver": from then on the feed is not cut at the freeze. */
  @Prop({ type: Date, default: null }) releasedAt!: Date | null;
}
export const ContestFeedKeySchema =
  SchemaFactory.createForClass(ContestFeedKey);
ContestFeedKeySchema.index({ contest: 1, _id: -1 });
