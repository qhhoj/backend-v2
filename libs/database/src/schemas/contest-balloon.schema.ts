import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Only deliveries are stored; pending items and the first-solve flag are derived from the scoreboard on every read. */
@Schema({ ...baseSchemaOptions, collection: 'contestBalloons' })
export class ContestBalloon {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ type: UUID, required: true }) participation!: string;
  /** The contest problem's problem id (the key of `formatData`). */
  @Prop({ type: UUID, required: true }) problem!: string;
  @Prop({ type: Date, required: true }) deliveredAt!: Date;
  @Prop({ type: UUID, required: true }) deliveredBy!: string;
}
export const ContestBalloonSchema =
  SchemaFactory.createForClass(ContestBalloon);
ContestBalloonSchema.index(
  { contest: 1, participation: 1, problem: 1 },
  { unique: true },
);
