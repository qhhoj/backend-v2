import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions } from '../schema';
import { codePointLength, MAX_SOURCE_LENGTH } from './submission.schema';

/** Kept apart from `submissions` so lists never carry source text; `_id` is the submission's id. */
@Schema({ ...baseSchemaOptions, collection: 'submissionSources' })
export class SubmissionSource {
  @Prop({ type: MongooseSchema.Types.UUID, required: true }) _id!: string;
  /** Counted in code points, like the DTO and legacy Python `len`; `maxlength` would count UTF-16 units. */
  @Prop({
    required: true,
    validate: {
      validator: (text: string) => codePointLength(text) <= MAX_SOURCE_LENGTH,
      message: `exceeds ${MAX_SOURCE_LENGTH} characters`,
    },
  })
  source!: string;
}
export const SubmissionSourceSchema =
  SchemaFactory.createForClass(SubmissionSource);
