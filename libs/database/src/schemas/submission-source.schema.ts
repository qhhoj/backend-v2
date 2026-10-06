import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions } from '../schema';
import { MAX_SOURCE_LENGTH } from './submission.schema';

/** Kept apart from `submissions` so lists never carry source text; `_id` is the submission's id. */
@Schema({ ...baseSchemaOptions, collection: 'submissionSources' })
export class SubmissionSource {
  @Prop({ type: MongooseSchema.Types.UUID, required: true }) _id!: string;
  @Prop({ required: true, maxlength: MAX_SOURCE_LENGTH }) source!: string;
}
export const SubmissionSourceSchema =
  SchemaFactory.createForClass(SubmissionSource);
