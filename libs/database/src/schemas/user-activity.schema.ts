import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Rows and sessions older than this are dropped by Mongo (legacy kept them forever). */
export const USER_ACTIVITY_RETENTION_SECONDS = 90 * 24 * 3600;

/** One response sent to one visitor. No query strings, cookies or credentials are ever stored. */
@Schema({ ...baseSchemaOptions, timestamps: false, collection: 'userActivity' })
export class UserActivity {
  @IdProp() _id!: string;
  @Prop({ type: UUID, default: null }) userId!: string | null;
  @Prop({ required: true }) sessionKey!: string;
  @Prop({ required: true, maxlength: 500 }) path!: string;
  @Prop({ required: true, maxlength: 10 }) method!: string;
  @Prop({ required: true }) ip!: string;
  @Prop({ default: '', maxlength: 500 }) userAgent!: string;
  @Prop({ default: '', maxlength: 500 }) referer!: string;
  @Prop({ required: true }) statusCode!: number;
  @Prop({ type: Date, required: true }) at!: Date;
}
export const UserActivitySchema = SchemaFactory.createForClass(UserActivity);
UserActivitySchema.index(
  { at: 1 },
  { expireAfterSeconds: USER_ACTIVITY_RETENTION_SECONDS },
);
UserActivitySchema.index({ userId: 1, at: -1 });
UserActivitySchema.index({ ip: 1, at: -1 });
