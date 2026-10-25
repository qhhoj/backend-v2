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
  /** FSO: stored while its contest runs, requeued at the end (`contest-final-judge`). */
  'PD',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
/** Waiting for or under judgement: these count towards the unfinished-submission limit and are never re-queued twice. */
export const UNFINISHED_STATUSES: readonly SubmissionStatus[] = [
  'QU',
  'P',
  'G',
];
/** Legacy `get_contest_submission_count`: `maxSubmissions` does not count these. */
export const UNCOUNTED_ATTEMPT_STATUSES: readonly SubmissionStatus[] = [
  'IE',
  'PD',
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
  /** CPU seconds of the solution. */
  @Prop({ default: 0 }) time!: number;
  /** CPU seconds of the problem's own programs on this case (custom checker, interactor); 0 for built-in checkers and from judges that do not report it. Absent on cases stored before it existed, which reads as 0. */
  @Prop({ default: 0 }) juryTime?: number;
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

/** A Judge build that answered `Final{RETRY Unsupported}` for the Submission against one data version: that build is not offered it again until the problem's data changes; another build of the same Judge is. */
@Schema({ _id: false })
export class RefusingJudge {
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) build!: string;
  /** The problem's `dataVersion` the Judge refused (`Final.dataVersionUsed`); absent on entries stored before it was recorded, which count as stale. */
  @Prop({ type: Number }) dataVersion?: number;
}
export const RefusingJudgeSchema = SchemaFactory.createForClass(RefusingJudge);

/** Why a Judge could not run the Submission for now (`Final{RETRY}` DATA_UNAVAILABLE, RUNTIME_MISSING, SANDBOX_FAILURE): its data was not there yet, the runtime is missing, the sandbox failed. */
export const DEFERRAL_REASONS = ['data', 'runtime', 'sandbox'] as const;
export type DeferralReason = (typeof DEFERRAL_REASONS)[number];

/** The Submission waits on a transient judge problem: requeued with a backoff, never counted in `retryCount`; IE only once the wait has lasted the bridge's deferral window. */
@Schema({ _id: false })
export class JudgeDeferral {
  @Prop({ type: String, required: true, enum: DEFERRAL_REASONS })
  reason!: DeferralReason;
  /** The first deferral since the last rejudge: the window is counted from it. */
  @Prop({ type: Date, required: true }) since!: Date;
  @Prop({ required: true }) count!: number;
  /** No judge is offered it before this. */
  @Prop({ type: Date, required: true }) retryAfter!: Date;
}
export const JudgeDeferralSchema = SchemaFactory.createForClass(JudgeDeferral);

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
  /** The contest it was submitted in (legacy `contest_object`); its row in `contestSubmissions` holds the participation. */
  @Prop({ type: UUID, default: null }) contest!: string | null;
  /** Judge disconnects survived while in flight; the second one is an internal error. */
  @Prop({ default: 0 }) requeueCount!: number;
  /** Bumped by every claim and never reset: a judge message names the generation it belongs to, so writes of an earlier run (before a requeue or rejudge) match nothing. */
  @Prop({ default: 0 }) judgeGeneration!: number;
  /** Seq of the last judge message stored for the current generation; the next one must be `judgeSeq + 1`. Reset to 0 by the claim. */
  @Prop({ default: 0 }) judgeSeq!: number;
  /** The case count the judge's Started named for the current generation (G only; a P row's value is an earlier generation's); the bridge re-arms a resumed run's deadline from it after a restart. */
  @Prop({ type: Number, default: null }) judgeCaseCount!: number | null;
  /** The problem data version the judge graded with (`Final.dataVersionUsed`, 0 = unstamped data); null until a judge finished it. */
  @Prop({ type: Number, default: null }) judgedDataVersion!: number | null;
  /** `Final{RETRY}` answers with no transient reason since the last rejudge (the judge failed it); the third is IE. Transient ones are `deferral`, refusals `refusedBy`. */
  @Prop({ default: 0 }) retryCount!: number;
  /** Runs requeued since the last rejudge because their Final could not be stored; past the first two each also counts in `retryCount`. */
  @Prop({ default: 0 }) unstoredCount!: number;
  /** The transient wait since the last rejudge (data not there yet, runtime missing, sandbox failure); null when there was none. */
  @Prop({ type: JudgeDeferralSchema, default: null })
  deferral!: JudgeDeferral | null;
  /** Judge builds that refused it as unsupported since the last rejudge, each with the data version it refused; never counted in `retryCount`. While it is QU with any, it waits for a Judge that can grade it or a data fix. */
  @Prop({ type: [RefusingJudgeSchema], default: [] })
  refusedBy!: RefusingJudge[];
  /** Set by every write that finishes the submission (D, CE, IE, AB, a reject) and cleared once its graded job applied the effects; the effects sweep re-applies rows still due, so a lost or failed graded job is repaired. */
  @Prop({ type: Date, default: null }) effectsDueAt!: Date | null;
  /** The judge chosen at submit (`judgeId`): only it takes the row, across accept timeouts, resyncs and restarts; cleared when that judge fails the run (grace expiry, RETRY) and by a rejudge. */
  @Prop({ type: String, default: null }) pinnedJudge!: string | null;
  /** Up to 10000 rows; loaded only by the detail view and the bridge's grading end. */
  @Prop({ type: [SubmissionCaseSchema], default: [], select: false })
  cases!: SubmissionCase[];
}

export const SubmissionSchema = SchemaFactory.createForClass(Submission);
// Lists sort by `-_id` (UUIDv7 is time-ordered), so the `_id` indexes replace `{problem, date}` and serve `{user, date}` lists, and `{date}` stays for date-range reports; the heatmap keeps its own `{user, date}`.
SubmissionSchema.index({ user: 1, _id: -1 });
SubmissionSchema.index({ problem: 1, _id: -1 });
// Filtered lists count by `problem $in` plus one more field (result, language, status): these keep that count index-only.
SubmissionSchema.index({ problem: 1, result: 1, _id: -1 });
SubmissionSchema.index({ problem: 1, language: 1, _id: -1 });
SubmissionSchema.index({ problem: 1, status: 1, _id: -1 });
SubmissionSchema.index({ user: 1, status: 1 });
SubmissionSchema.index({ user: 1, problem: 1, result: 1 });
SubmissionSchema.index({ status: 1, priority: 1, _id: 1 });
SubmissionSchema.index({ date: -1 });
// The user's submission heatmap (a date window per user; migrated ids do not follow dates).
SubmissionSchema.index({ user: 1, date: -1 });
// The effects sweep reads the users and problems graded in its window.
SubmissionSchema.index({ judgedDate: 1 });
// The effects sweep reads the rows whose effects are still due; the normal state is cleared, so the index stays small.
SubmissionSchema.index(
  { effectsDueAt: 1 },
  { partialFilterExpression: { effectsDueAt: { $type: 'date' } } },
);
// Problem stats count a problem's rows of listed users without reading documents.
SubmissionSchema.index({ problem: 1, user: 1 });
// The contest submission list sorts one contest's rows by `-_id`; FSO judging finds contests with pending rows and reads each one's in id order.
SubmissionSchema.index({ contest: 1, _id: -1 });
SubmissionSchema.index({ status: 1, contest: 1, _id: 1 });
