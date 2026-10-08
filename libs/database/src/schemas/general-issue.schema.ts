import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

/** Legacy `GeneralIssue`: the page a general ticket is about. Only `http(s)` urls are stored (checked by the api). */
@Schema({ ...baseSchemaOptions, collection: 'generalIssues' })
export class GeneralIssue {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 200 }) issueUrl!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
export const GeneralIssueSchema = SchemaFactory.createForClass(GeneralIssue);
