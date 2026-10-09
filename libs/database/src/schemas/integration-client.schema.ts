import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const INTEGRATION_SCOPES = ['contests:write', 'contests:read'] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** An external system's credential. Never a user: it has no session, no profile and no rating, and acts as `actsAs` only through the sync service. */
@Schema({ ...baseSchemaOptions, collection: 'integrationClients' })
export class IntegrationClient {
  @IdProp() _id!: string;
  @Prop({ required: true, minlength: 1, maxlength: 60 }) name!: string;
  /** sha256 of the full `qhi_...` key. The key itself is shown once and never stored. */
  @Prop({ required: true, match: SHA256_HEX }) keyHash!: string;
  /** First characters of the key, to recognise it in the list. */
  @Prop({ required: true, maxlength: 12 }) keyPrefix!: string;
  @Prop({ type: [String], enum: INTEGRATION_SCOPES, default: [] })
  scopes!: IntegrationScope[];
  /** Addresses the client may call from; an empty list matches nothing. */
  @Prop({ type: [String], default: [] }) allowedCidrs!: string[];
  /** The user whose permissions bound every check and who becomes the author of contests the client creates. */
  @Prop({ type: UUID, required: true }) actsAs!: string;
  @Prop({ type: UUID, required: true }) createdBy!: string;
  @Prop({ type: Date, default: null }) lastUsedAt!: Date | null;
  @Prop({ type: Date, default: null }) revokedAt!: Date | null;
  /** The key stops working at this instant; null never expires. */
  @Prop({ type: Date, default: null }) expiresAt!: Date | null;
  createdAt!: Date;
}

export const IntegrationClientSchema =
  SchemaFactory.createForClass(IntegrationClient);
IntegrationClientSchema.index({ keyHash: 1 }, { unique: true });
