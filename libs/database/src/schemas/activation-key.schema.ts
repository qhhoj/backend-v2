import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

@Schema({ ...baseSchemaOptions, collection: 'activationKeys' })
export class ActivationKey {
  @IdProp() _id!: string;
  @Prop({ type: MSchema.Types.UUID, required: true }) userId!: string;
  @Prop({ required: true, unique: true }) keyHash!: string;
  @Prop({ required: true }) expiresAt!: Date;
}

export const ActivationKeySchema = SchemaFactory.createForClass(ActivationKey);
ActivationKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
