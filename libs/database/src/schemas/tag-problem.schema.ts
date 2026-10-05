import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;
export const TAG_PROBLEM_CODE_PATTERN = /^[a-zA-Z0-9_]{1,32}$/;

@Schema({ _id: false })
export class TagAssignment {
  @Prop({ type: UUID, required: true }) tagId!: string;
  @Prop({ type: UUID, required: true }) assignerId!: string;
}

/** A problem on an external judge, tagged by the community (legacy `TagProblem` + `TagData`). */
@Schema({ ...baseSchemaOptions, collection: 'tagProblems' })
export class TagProblem {
  @IdProp() _id!: string;
  @Prop({ required: true, match: TAG_PROBLEM_CODE_PATTERN }) code!: string;
  @Prop({ required: true, maxlength: 100 }) name!: string;
  @Prop({ required: true, maxlength: 200 }) link!: string;
  @Prop({ type: String, default: null }) judge!: string | null;
  @Prop({ type: [SchemaFactory.createForClass(TagAssignment)], default: [] })
  tags!: TagAssignment[];
}
export const TagProblemSchema = SchemaFactory.createForClass(TagProblem);
ciIndex(TagProblemSchema, 'code');
TagProblemSchema.index({ name: 1 });
TagProblemSchema.index({ judge: 1 });
TagProblemSchema.index({ 'tags.tagId': 1 });
