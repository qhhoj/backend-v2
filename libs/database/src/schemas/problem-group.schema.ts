import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'problemGroups' })
export class ProblemGroup {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 20 }) name!: string;
  @Prop({ required: true, maxlength: 100 }) fullName!: string;
}
export const ProblemGroupSchema = SchemaFactory.createForClass(ProblemGroup);
ciIndex(ProblemGroupSchema, 'name');
