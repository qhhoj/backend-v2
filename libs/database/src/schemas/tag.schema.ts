import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'tags' })
export class Tag {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 30 }) code!: string;
  @Prop({ required: true, maxlength: 100 }) name!: string;
  @Prop({ type: MongooseSchema.Types.UUID, required: true }) groupId!: string;
}
export const TagSchema = SchemaFactory.createForClass(Tag);
ciIndex(TagSchema, 'code');
TagSchema.index({ groupId: 1 });
