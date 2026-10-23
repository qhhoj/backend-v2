import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { USAGE_MONTH_PATTERN } from './organization-usage.schema';

const UUID = MongooseSchema.Types.UUID;

/** 13 months: a full year plus the current one. */
export const LEDGER_RETENTION_SECONDS = 396 * 86_400;
/** How a charged run ended: graded, compile error, internal error, aborted. */
export const JUDGING_CHARGE_STATUSES = ['D', 'CE', 'IE', 'AB'] as const;
export type JudgingChargeStatus = (typeof JUDGING_CHARGE_STATUSES)[number];

/** Append-only: the judging time one grading attempt (submission, judge generation) used, charged to the organization that owned the problem. An organization's monthly meter is the sum of its rows, so there is no counter to drift. */
@Schema({
  ...baseSchemaOptions,
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'organizationJudgingCharges',
})
export class OrganizationJudgingCharge {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) organization!: string;
  /** `YYYY-MM` in the site time zone when the charge was recorded; never recomputed. */
  @Prop({ required: true, match: USAGE_MONTH_PATTERN }) month!: string;
  @Prop({ type: UUID, required: true }) submission!: string;
  /** The submission's `judgeGeneration` of the charged run. */
  @Prop({ required: true, min: 0 }) generation!: number;
  @Prop({ type: UUID, required: true }) problem!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: String, required: true, enum: JUDGING_CHARGE_STATUSES })
  status!: JudgingChargeStatus;
  /** CPU milliseconds of the run's stored cases (solution plus checker and interactor); a run of 0 ms writes no row. */
  @Prop({
    required: true,
    min: 1,
    validate: { validator: Number.isInteger, message: 'must be an integer' },
  })
  ms!: number;
  createdAt!: Date;
}

export const OrganizationJudgingChargeSchema = SchemaFactory.createForClass(
  OrganizationJudgingCharge,
);
// A grading attempt is charged once, whatever redelivers its graded job.
OrganizationJudgingChargeSchema.index(
  { submission: 1, generation: 1 },
  { unique: true },
);
// The month's sum and the top problems are answered from this index alone.
OrganizationJudgingChargeSchema.index({
  organization: 1,
  month: 1,
  problem: 1,
  ms: 1,
});
OrganizationJudgingChargeSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: LEDGER_RETENTION_SECONDS },
);
