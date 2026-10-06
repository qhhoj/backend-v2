import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';

const UUID = MongooseSchema.Types.UUID;

export const SUBMISSION_STATUSES = [
  'QU',
  'P',
  'G',
  'D',
  'IE',
  'CE',
  'AB',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
/** Waiting for or under judgement: these count towards the unfinished-submission limit and are never re-queued twice. */
export const UNFINISHED_STATUSES: readonly SubmissionStatus[] = [
  'QU',
  'P',
  'G',
];
/** Handed to a judge: P until `grading-begin`, then G. */
export const IN_FLIGHT_STATUSES: readonly SubmissionStatus[] = ['P', 'G'];
export const SUBMISSION_RESULTS = [
  'AC',
  'WA',
  'TLE',
  'MLE',
  'OLE',
  'IR',
  'RTE',
  'CE',
  'IE',
  'SC',
  'AB',
  'RJ',
] as const;
export type SubmissionResult = (typeof SUBMISSION_RESULTS)[number];
export const CASE_STATUSES = [
  'AC',
  'WA',
  'TLE',
  'MLE',
  'OLE',
  'IR',
  'RTE',
  'SC',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
/** Legacy `judge_priority.py`: lower is served first. */
export const SUBMISSION_PRIORITY = {
  contest: 0,
  normal: 1,
  rejudge: 2,
  batchRejudge: 3,
} as const;
export const MAX_SOURCE_LENGTH = 65536;
/** Unicode code points (legacy Python `len`): neither UTF-16 units nor validator.js `isLength`, which drops variation selectors. */
export const codePointLength = (text: string): number => [...text].length;
/** Bytes, not characters: bounds the 10000-case submission document under Mongo's 16 MB. */
export const MAX_CASE_FEEDBACK_LENGTH = 50;
export const MAX_CASE_TEXT_LENGTH = 512;
const withinBytes = (limit: number) => ({
  validator: (text: string) => Buffer.byteLength(text) <= limit,
  message: `exceeds ${limit} bytes`,
});

@Schema({ _id: false })
export class SubmissionCase {
  @Prop({ required: true }) position!: number;
  @Prop({ type: String, required: true, enum: CASE_STATUSES })
  status!: CaseStatus;
  @Prop({ default: 0 }) time!: number;
  @Prop({ default: 0 }) memory!: number;
  @Prop({ default: 0 }) points!: number;
  @Prop({ default: 0 }) total!: number;
  /** Batch number (1-based) or null for a case outside any batch. */
  @Prop({ type: Number, default: null }) batch!: number | null;
  @Prop({ default: '', validate: withinBytes(MAX_CASE_FEEDBACK_LENGTH) })
  feedback!: string;
  @Prop({ default: '', validate: withinBytes(MAX_CASE_TEXT_LENGTH) })
  extendedFeedback!: string;
  @Prop({ default: '', validate: withinBytes(MAX_CASE_TEXT_LENGTH) })
  output!: string;
}
export const SubmissionCaseSchema =
  SchemaFactory.createForClass(SubmissionCase);

@Schema({ ...baseSchemaOptions, collection: 'submissions' })
export class Submission {
  @IdProp() _id!: string;
  @Prop({ type: UUID, required: true }) user!: string;
  @Prop({ type: UUID, required: true }) problem!: string;
  @Prop({ type: UUID, required: true }) language!: string;
  @Prop({ type: Date, default: () => new Date() }) date!: Date;
  @Prop({ type: String, default: 'QU', enum: SUBMISSION_STATUSES })
  status!: SubmissionStatus;
  @Prop({ type: String, default: null, enum: SUBMISSION_RESULTS })
  result!: SubmissionResult | null;
  @Prop({ type: Number, default: null }) time!: number | null;
  @Prop({ type: Number, default: null }) memory!: number | null;
  @Prop({ type: Number, default: null }) points!: number | null;
  @Prop({ default: 0 }) casePoints!: number;
  @Prop({ default: 0 }) caseTotal!: number;
  /** Compile log (CE), compiler warnings (D) or the judge's internal error message (IE). */
  @Prop({ type: String, default: null }) error!: string | null;
  @Prop({ default: 0 }) currentTestcase!: number;
  @Prop({ default: false }) batch!: boolean;
  @Prop({ default: false }) isPretested!: boolean;
  @Prop({
    default: SUBMISSION_PRIORITY.normal,
    min: SUBMISSION_PRIORITY.contest,
    max: SUBMISSION_PRIORITY.batchRejudge,
  })
  priority!: number;
  /** Name of the judge it was last handed to; every judge packet's write is filtered on it. */
  @Prop({ type: String, default: null }) judgedOn!: string | null;
  @Prop({ type: Date, default: null }) judgedDate!: Date | null;
  @Prop({ type: Date, default: null }) rejudgedDate!: Date | null;
  @Prop({ type: Date, default: null }) lockedAfter!: Date | null;
  /** Filled by sub-project 4. */
  @Prop({ type: UUID, default: null }) contest!: string | null;
  /** Judge disconnects survived while in flight; the second one is an internal error. */
  @Prop({ default: 0 }) requeueCount!: number;
  /** Up to 10000 rows; loaded only by the detail view and the bridge's grading end. */
  @Prop({ type: [SubmissionCaseSchema], default: [], select: false })
  cases!: SubmissionCase[];
}

export const SubmissionSchema = SchemaFactory.createForClass(Submission);
// Lists sort by `-_id` (UUIDv7 is time-ordered), so the `_id` indexes replace the spec's `{user, date}` and `{problem, date}`; `{date}` stays for date-range reports.
SubmissionSchema.index({ user: 1, _id: -1 });
SubmissionSchema.index({ problem: 1, _id: -1 });
// Filtered lists count by `problem $in` plus one more field: these keep that count index-only.
SubmissionSchema.index({ problem: 1, result: 1, _id: -1 });
SubmissionSchema.index({ problem: 1, language: 1, _id: -1 });
SubmissionSchema.index({ user: 1, status: 1 });
SubmissionSchema.index({ user: 1, problem: 1, result: 1 });
SubmissionSchema.index({ status: 1, priority: 1, _id: 1 });
SubmissionSchema.index({ date: -1 });
