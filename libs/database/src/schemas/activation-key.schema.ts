import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'activationKeys' })
export class ActivationKey {
  @IdProp() _id!: string;
  @Prop({ type: MSchema.Types.UUID, required: true }) userId!: string;
  @Prop({ required: true, unique: true }) keyHash!: string;
  @Prop({ required: true }) expiresAt!: Date;
  /** The user's credential epoch when the key was mailed; activation refuses it once the epoch has moved on (an e-mail change). Keys from before the field read 0. */
  @Prop({ default: 0 }) credentialEpoch!: number;
}

export const ActivationKeySchema = SchemaFactory.createForClass(ActivationKey);
ActivationKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
