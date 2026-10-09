import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { CONTEST_TAG_PATTERN } from './contest.schema';
import { TAG_COLORS } from './tag-color';
import type { TagColor } from './tag-color';

/** The managed catalogue behind `Contest.tags` (which stays an array of slugs). */
@Schema({ ...baseSchemaOptions, collection: 'contestTags' })
export class ContestTag {
  @IdProp() _id!: string;
  @Prop({ required: true, match: CONTEST_TAG_PATTERN }) slug!: string;
  @Prop({ required: true, maxlength: 40 }) name!: string;
  @Prop({ type: String, required: true, enum: TAG_COLORS })
  color!: TagColor;
  @Prop({ default: '', maxlength: 200 }) description!: string;
  @Prop({ default: 0 }) order!: number;
}

export const ContestTagSchema = SchemaFactory.createForClass(ContestTag);
ContestTagSchema.index({ slug: 1 }, { unique: true });
