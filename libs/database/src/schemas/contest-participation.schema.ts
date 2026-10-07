import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;
const Mixed = MongooseSchema.Types.Mixed;

// `minimize: false` keeps empty `formatData` cells stored.
@Schema({
  ...baseSchemaOptions,
  collection: 'contestParticipations',
  minimize: false,
})
export class ContestParticipation {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  /** When the user joined; meaningless while `isRegistered`. */
  @Prop({ type: Date, required: true }) realStart!: Date;
  /** 0 live, -1 spectate, n ≥ 1 the n-th virtual participation. */
  @Prop({ default: 0, min: -1 }) virtual!: number;
  @Prop({ default: 0 }) score!: number;
  @Prop({ default: 0 }) cumtime!: number;
  @Prop({ default: 0 }) tiebreaker!: number;
  @Prop({ default: 0 }) frozenScore!: number;
  @Prop({ default: 0 }) frozenCumtime!: number;
  @Prop({ default: 0 }) frozenTiebreaker!: number;
  /** Per problem id, the format's cell (`ProblemCell`, `@libs/contests`). */
  @Prop({ type: Mixed, default: () => ({}) }) formatData!: Record<
    string,
    unknown
  >;
  /** The cells a frozen board shows. */
  @Prop({ type: Mixed, default: () => ({}) }) frozenFormatData!: Record<
    string,
    unknown
  >;
  @Prop({ default: false }) isDisqualified!: boolean;
  /** Registered and not joined yet (legacy: `real_start` 1970-01-01). */
  @Prop({ default: false }) isRegistered!: boolean;
}

export const ContestParticipationSchema =
  SchemaFactory.createForClass(ContestParticipation);
ContestParticipationSchema.index(
  { contest: 1, user: 1, virtual: 1 },
  { unique: true },
);
// Rankings and rescores read one contest's rows; a user's history reads theirs.
ContestParticipationSchema.index({ contest: 1, virtual: 1 });
ContestParticipationSchema.index({ user: 1 });
