import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { LEDGER_RETENTION_SECONDS } from './organization-judging-charge.schema';
import { USAGE_MONTH_PATTERN } from './organization-usage.schema';

const UUID = MongooseSchema.Types.UUID;

export const CREDIT_REASONS = [
  'problem',
  'contest',
  'upload',
  'refund',
] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

/** Append-only record of every spend; a refund is a negative `amount`. The nightly audit compares its sums with `organizationUsage`. */
@Schema({ ...baseSchemaOptions, collection: 'organizationCreditEntries' })
export class OrganizationCreditEntry {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  @Prop({ required: true, match: USAGE_MONTH_PATTERN }) month!: string;
  @Prop({ type: String, required: true, enum: CREDIT_REASONS })
  reason!: CreditReason;
  @Prop({ required: true }) amount!: number;
  @Prop({ type: UUID, default: null }) user!: string | null;
  /** Problem code or contest key the spend was for. */
  @Prop({ default: '' }) ref!: string;
  createdAt!: Date;
}

export const OrganizationCreditEntrySchema = SchemaFactory.createForClass(
  OrganizationCreditEntry,
);
OrganizationCreditEntrySchema.index({ organization: 1, month: 1, _id: -1 });
OrganizationCreditEntrySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: LEDGER_RETENTION_SECONDS },
);
