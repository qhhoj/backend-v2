import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

@Schema({ _id: false })
export class OfficialRankingRow {
  @Prop({ required: true, maxlength: 200 }) username!: string;
  @Prop({ default: '', maxlength: 200 }) fullName!: string;
  @Prop({ type: [Number], default: [] }) scores!: number[];
  @Prop({ default: 0 }) totalScore!: number;
}
export const OfficialRankingRowSchema =
  SchemaFactory.createForClass(OfficialRankingRow);

/** Kept out of `contests` so the up-to-1 MiB table is never read with a contest. */
@Schema({ ...baseSchemaOptions, collection: 'contestOfficialRankings' })
export class ContestOfficialRanking {
  /** The contest's id: one document per contest. */
  @IdProp() _id!: string;
  @Prop({ type: String, default: null }) url!: string | null;
  @Prop({ type: [String], default: [] }) problems!: string[];
  @Prop({ type: [OfficialRankingRowSchema], default: [] })
  rows!: OfficialRankingRow[];
}

export const ContestOfficialRankingSchema = SchemaFactory.createForClass(
  ContestOfficialRanking,
);
