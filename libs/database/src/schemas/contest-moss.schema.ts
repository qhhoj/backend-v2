import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Legacy `ContestMoss.LANG_MAPPING`: language common name → MOSS language. */
export const MOSS_LANGUAGES = [
  ['C', 'c'],
  ['C++', 'cc'],
  ['Java', 'java'],
  ['Python', 'python'],
  ['Pascal', 'pascal'],
] as const;
export type MossLanguage = (typeof MOSS_LANGUAGES)[number][0];

@Schema({ ...baseSchemaOptions, collection: 'contestMoss' })
export class ContestMoss {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) contest!: string;
  @Prop({ type: UUID, required: true }) problem!: string;
  @Prop({
    type: String,
    required: true,
    enum: MOSS_LANGUAGES.map(([name]) => name),
  })
  language!: MossLanguage;
  @Prop({ default: 0, min: 0 }) submissionCount!: number;
  /** Null when no submission qualified (legacy kept the row). */
  @Prop({ type: String, default: null }) url!: string | null;
}

export const ContestMossSchema = SchemaFactory.createForClass(ContestMoss);
ContestMossSchema.index(
  { contest: 1, problem: 1, language: 1 },
  { unique: true },
);
