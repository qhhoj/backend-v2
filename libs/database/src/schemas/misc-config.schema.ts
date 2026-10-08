import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

export const MISC_CONFIG_KEY_MAX = 30;
/** Not a schema bound; the staff API refuses longer values. */
export const MISC_CONFIG_VALUE_MAX = 20_000;

/** Legacy `MiscConfig`: key/value text; keys are unique here (legacy kept the last row per key). Served publicly by `GET /site`: never store secrets. */
@Schema({ ...baseSchemaOptions, collection: 'miscConfig' })
export class MiscConfig {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: MISC_CONFIG_KEY_MAX }) key!: string;
  @Prop({ default: '' }) value!: string;
  createdAt!: Date;
  updatedAt!: Date;
}
export const MiscConfigSchema = SchemaFactory.createForClass(MiscConfig);
MiscConfigSchema.index({ key: 1 }, { unique: true });
