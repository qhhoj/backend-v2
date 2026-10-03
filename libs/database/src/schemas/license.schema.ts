import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, ciIndex, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'licenses' })
export class License {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 20 }) key!: string;
  @Prop({ required: true, maxlength: 256 }) name!: string;
  @Prop({ default: '' }) link!: string;
  @Prop({ default: '' }) display!: string;
  @Prop({ default: '' }) icon!: string;
  @Prop({ default: '' }) text!: string;
}
export const LicenseSchema = SchemaFactory.createForClass(License);
ciIndex(LicenseSchema, 'key');
