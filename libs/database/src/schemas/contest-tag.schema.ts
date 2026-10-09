import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { CONTEST_TAG_PATTERN } from './contest.schema';

/** Colour token keys, defined in every theme file by the frontend; the API never stores a hex. */
export const CONTEST_TAG_COLORS = [
  'tag-1',
  'tag-2',
  'tag-3',
  'tag-4',
  'tag-5',
  'tag-6',
  'tag-7',
  'tag-8',
] as const;
export type ContestTagColor = (typeof CONTEST_TAG_COLORS)[number];

/** The managed catalogue behind `Contest.tags` (which stays an array of slugs). */
@Schema({ ...baseSchemaOptions, collection: 'contestTags' })
export class ContestTag {
  @IdProp() _id!: string;
  @Prop({ required: true, match: CONTEST_TAG_PATTERN }) slug!: string;
  @Prop({ required: true, maxlength: 40 }) name!: string;
  @Prop({ type: String, required: true, enum: CONTEST_TAG_COLORS })
  color!: ContestTagColor;
  @Prop({ default: '', maxlength: 200 }) description!: string;
  @Prop({ default: 0 }) order!: number;
}

export const ContestTagSchema = SchemaFactory.createForClass(ContestTag);
ContestTagSchema.index({ slug: 1 }, { unique: true });
