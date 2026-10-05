import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'tagGroups' })
export class TagGroup {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 30 }) code!: string;
  @Prop({ required: true, maxlength: 100 }) name!: string;
}
export const TagGroupSchema = SchemaFactory.createForClass(TagGroup);
ciIndex(TagGroupSchema, 'code');
