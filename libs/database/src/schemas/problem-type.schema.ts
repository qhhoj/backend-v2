import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'problemTypes' })
export class ProblemType {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 20 }) name!: string;
  @Prop({ required: true, maxlength: 100 }) fullName!: string;
}
export const ProblemTypeSchema = SchemaFactory.createForClass(ProblemType);
ciIndex(ProblemTypeSchema, 'name');
