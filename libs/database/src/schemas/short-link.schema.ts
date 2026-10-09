import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** No look-alikes (no 0/o, 1/l/i): 31 symbols, readable aloud. */
export const SHORT_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const SHORT_CODE_LENGTH = 6;
/** Codes staff choose themselves. */
export const CUSTOM_SHORT_CODE_PATTERN = /^[a-z0-9-]{3,32}$/;

/** A short URL for a same-site path. `isAuto` links (made for any signed-in user) are unique per path; staff links with chosen codes are not. */
@Schema({ ...baseSchemaOptions, collection: 'shortLinks' })
export class ShortLink {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 32 }) code!: string;
  @Prop({ required: true, maxlength: 200 }) path!: string;
  @Prop({ type: UUID, required: true }) createdBy!: string;
  @Prop({ default: true }) isAuto!: boolean;
  /** Event counter: the one `$inc` besides notification counts. */
  @Prop({ default: 0, min: 0 }) hits!: number;
  @Prop({ type: Date, default: null }) lastHitAt!: Date | null;
  @Prop({ type: Date, default: null }) expiresAt!: Date | null;
  createdAt!: Date;
}

export const ShortLinkSchema = SchemaFactory.createForClass(ShortLink);
ShortLinkSchema.index({ code: 1 }, { unique: true });
ShortLinkSchema.index(
  { path: 1 },
  { unique: true, partialFilterExpression: { isAuto: true } },
);
// A user's own links, newest first.
ShortLinkSchema.index({ createdBy: 1, _id: -1 });
