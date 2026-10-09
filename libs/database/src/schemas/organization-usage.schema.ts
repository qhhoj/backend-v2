import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** Month key in the site time zone: `YYYY-MM`. */
export const USAGE_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
export const QUOTA_METERS = ['credits', 'storage'] as const;
export type QuotaMeterName = (typeof QUOTA_METERS)[number];

/** Credits an organization spent in one month. The only `$inc`-written counter besides event counters: a guarded atomic update. */
@Schema({ ...baseSchemaOptions, collection: 'organizationUsage' })
export class OrganizationUsage {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  @Prop({ required: true, match: USAGE_MONTH_PATTERN }) month!: string;
  @Prop({ default: 0, min: 0 }) creditsUsed!: number;
  /** Meters whose 80% warning was already sent this month. */
  @Prop({ type: [String], enum: QUOTA_METERS, default: [] })
  warnedMeters!: QuotaMeterName[];
}

export const OrganizationUsageSchema =
  SchemaFactory.createForClass(OrganizationUsage);
OrganizationUsageSchema.index({ organization: 1, month: 1 }, { unique: true });
