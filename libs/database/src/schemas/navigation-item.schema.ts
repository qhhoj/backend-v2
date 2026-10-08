import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const NAVIGATION_KEY_MAX = 10;
export const NAVIGATION_LABEL_MAX = 20;
export const NAVIGATION_PATH_MAX = 255;
/** Not a schema bound (migrated legacy regexes may be longer); the staff API refuses longer ones. */
export const NAVIGATION_REGEX_MAX = 500;

/** Legacy `NavigationBar` (MPTT) as a flat list: `parentId` and `order` build the tree; `regex` is a JavaScript regular expression the SPA tests against the current path. */
@Schema({ ...baseSchemaOptions, collection: 'navigationBar' })
export class NavigationItem {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: NAVIGATION_KEY_MAX }) key!: string;
  @Prop({ required: true, maxlength: NAVIGATION_LABEL_MAX }) label!: string;
  @Prop({ required: true, maxlength: NAVIGATION_PATH_MAX }) path!: string;
  @Prop({ default: '' }) regex!: string;
  @Prop({ default: false }) hidden!: boolean;
  @Prop({ required: true, min: 0 }) order!: number;
  @Prop({ type: UUID, default: null }) parentId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
export const NavigationItemSchema =
  SchemaFactory.createForClass(NavigationItem);
NavigationItemSchema.index({ key: 1 }, { unique: true });
