import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Legacy `Rating`: one per rated live participation. */
@Schema({ ...baseSchemaOptions, collection: 'ratings' })
export class Rating {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ type: UUID, required: true }) participation!: string;
  /** The contest's end, copied: history reads and re-rating ranges order and filter by it (Mongo has no join for `-contest__end_time`). */
  @Prop({ type: Date, required: true }) contestEndTime!: Date;
  /** 1-based; tied participants share the mean of their places (2.5). Legacy truncated it into an integer column. */
  @Prop({ required: true, min: 1 }) rank!: number;
  @Prop({ required: true }) rating!: number;
  @Prop({ required: true }) mean!: number;
  @Prop({ required: true }) performance!: number;
  @Prop({ type: Date, required: true }) lastRated!: Date;
}

export const RatingSchema = SchemaFactory.createForClass(Rating);
RatingSchema.index({ contest: 1, user: 1 }, { unique: true });
RatingSchema.index({ participation: 1 }, { unique: true });
// A user's history newest first; `users.rating` is the first row.
RatingSchema.index({ user: 1, contestEndTime: -1 });
// A re-rate deletes every rating from the target's end on.
RatingSchema.index({ contestEndTime: 1 });
