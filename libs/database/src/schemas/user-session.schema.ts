import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { USER_ACTIVITY_RETENTION_SECONDS } from './user-activity.schema';

const UUID = MongooseSchema.Types.UUID;

/** Legacy `UserSession` as an activity summary per visitor (`sessionKey` is a hash, see `activitySessionKey`); upserted by the activity flush. */
@Schema({ ...baseSchemaOptions, collection: 'userSessions' })
export class UserSession {
  @IdProp() _id!: string;
  @Prop({ required: true }) sessionKey!: string;
  @Prop({ type: UUID, default: null }) userId!: string | null;
  @Prop({ required: true }) ip!: string;
  @Prop({ default: '', maxlength: 500 }) userAgent!: string;
  @Prop({ default: 'unknown' }) deviceType!: string;
  @Prop({ default: '' }) browser!: string;
  @Prop({ default: '' }) os!: string;
  @Prop({ type: Date, required: true }) lastActivityAt!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}
export const UserSessionSchema = SchemaFactory.createForClass(UserSession);
UserSessionSchema.index({ sessionKey: 1 }, { unique: true });
UserSessionSchema.index(
  { lastActivityAt: 1 },
  { expireAfterSeconds: USER_ACTIVITY_RETENTION_SECONDS },
);
UserSessionSchema.index({ userId: 1, lastActivityAt: -1 });
