import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const ORGANIZATION_REQUEST_STATES = ['P', 'A', 'R'] as const;
export type OrganizationRequestState =
  (typeof ORGANIZATION_REQUEST_STATES)[number];
export const REQUEST_REASON_MAX_LENGTH = 4096;

/** Legacy `OrganizationRequest` plus who decided it and when. */
@Schema({ ...baseSchemaOptions, collection: 'organizationRequests' })
export class OrganizationRequest {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: String, enum: ORGANIZATION_REQUEST_STATES, default: 'P' })
  state!: OrganizationRequestState;
  /** Optional since 2026-10-18: empty when the requester gave none. */
  @Prop({ type: String, default: '', maxlength: REQUEST_REASON_MAX_LENGTH })
  reason!: string;
  @Prop({ type: UUID, default: null }) decidedBy!: string | null;
  @Prop({ type: Date, default: null }) decidedAt!: Date | null;
  createdAt!: Date;
}

export const OrganizationRequestSchema =
  SchemaFactory.createForClass(OrganizationRequest);
// One pending request per user and organization; queries must name `state: 'P'` to use it.
OrganizationRequestSchema.index(
  { organization: 1, user: 1 },
  { unique: true, partialFilterExpression: { state: 'P' } },
);
// Admin lists per state, newest first.
OrganizationRequestSchema.index({ organization: 1, state: 1, _id: -1 });
// The staff queue across organizations, per state, newest first.
OrganizationRequestSchema.index({ state: 1, _id: -1 });
OrganizationRequestSchema.index({ user: 1, _id: -1 });
