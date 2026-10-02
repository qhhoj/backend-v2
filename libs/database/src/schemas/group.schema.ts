import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'groups' })
export class Group {
  @IdProp() _id!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ type: [String], default: [] }) permissions!: string[];
}
export const GroupSchema = SchemaFactory.createForClass(Group);
ciIndex(GroupSchema, 'name');
