import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

@Schema({ _id: false })
export class ContestGhostCell {
  @Prop({ type: UUID, required: true }) problemId!: string;
  /** Whole minutes from the contest start to the accepted solve. */
  @Prop({ required: true, min: 0, max: 99999 }) minute!: number;
  /** Wrong tries before the solve (at most 99: each is a synthetic row to score); null: the source lacks it. */
  @Prop({ type: Number, default: null, min: 0, max: 99 }) rejectedBefore!:
    number | null;
  /** Points of the solve; null: the source lacks it. */
  @Prop({ type: Number, default: null, min: 0 }) points!: number | null;
}
export const ContestGhostCellSchema =
  SchemaFactory.createForClass(ContestGhostCell);

/** A historical standing row that is not a user: shown in replay and the virtual overlay, never in the ranking, stats or rating. */
@Schema({ ...baseSchemaOptions, collection: 'contestGhosts' })
export class ContestGhost {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ required: true, maxlength: 64 }) label!: string;
  @Prop({ default: '', maxlength: 64 }) caption!: string;
  @Prop({ type: [ContestGhostCellSchema], default: [] })
  cells!: ContestGhostCell[];
}
export const ContestGhostSchema = SchemaFactory.createForClass(ContestGhost);
ContestGhostSchema.index({ contest: 1, label: 1 }, { unique: true });
