import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { CASE_STATUSES, SUBMISSION_RESULTS } from './submission.schema';
import type { CaseStatus, SubmissionResult } from './submission.schema';

const UUID = MongooseSchema.Types.UUID;

export const SHARE_KINDS = ['submission', 'paste'] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];
/** The submission statuses a frozen copy may hold: a finished run that was judged or failed to compile. */
export const SHAREABLE_STATUSES = ['D', 'CE'] as const;
export type ShareableStatus = (typeof SHAREABLE_STATUSES)[number];
/** Share codes reuse the short-link alphabet (`SHORT_CODE_ALPHABET`), longer because the code is the only secret of an unlisted link. */
export const SHARE_CODE_LENGTH = 10;
export const SHARE_TITLE_MAX_LENGTH = 100;

/** The language as it was at share time, so a later rename or retirement changes nothing. */
@Schema({ _id: false })
export class ShareLanguage {
  @Prop({ type: UUID, required: true }) id!: string;
  @Prop({ required: true }) key!: string;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) extension!: string;
}
export const ShareLanguageSchema = SchemaFactory.createForClass(ShareLanguage);

/** One test case of a frozen copy: never feedback or program output. */
@Schema({ _id: false })
export class ShareCase {
  @Prop({ required: true }) position!: number;
  @Prop({ type: String, required: true, enum: CASE_STATUSES })
  status!: CaseStatus;
  @Prop({ required: true }) time!: number;
  @Prop({ required: true }) memory!: number;
  @Prop({ required: true }) points!: number;
  @Prop({ required: true }) total!: number;
  @Prop({ type: Number, default: null }) batch!: number | null;
}
export const ShareCaseSchema = SchemaFactory.createForClass(ShareCase);

/** One batch summary of a frozen copy (legacy `make_batch`). */
@Schema({ _id: false })
export class ShareBatch {
  @Prop({ required: true }) batch!: number;
  @Prop({ type: String, required: true, enum: CASE_STATUSES })
  status!: CaseStatus;
  @Prop({ required: true }) points!: number;
  @Prop({ required: true }) total!: number;
}
export const ShareBatchSchema = SchemaFactory.createForClass(ShareBatch);

/** What a visitor may see of a submission's result, stored at share time: a rejudge or a problem edit changes nothing. */
@Schema({ _id: false })
export class ShareCopy {
  @Prop({ type: UUID, required: true }) submissionId!: string;
  /** Only the id: the problem's name and link are resolved for each viewer. */
  @Prop({ type: UUID, required: true }) problem!: string;
  /** The contest the submission was made in; null for practice. */
  @Prop({ type: UUID, default: null }) contest!: string | null;
  @Prop({ type: String, required: true, enum: SHAREABLE_STATUSES })
  status!: ShareableStatus;
  @Prop({ type: String, default: null, enum: SUBMISSION_RESULTS })
  result!: SubmissionResult | null;
  @Prop({ type: Number, default: null }) points!: number | null;
  /** The problem's points at share time, so "60 / 100" never drifts. */
  @Prop({ required: true }) problemPoints!: number;
  @Prop({ default: 0 }) casePoints!: number;
  @Prop({ default: 0 }) caseTotal!: number;
  @Prop({ type: Number, default: null }) time!: number | null;
  @Prop({ type: Number, default: null }) memory!: number | null;
  @Prop({ type: Date, required: true }) submittedAt!: Date;
  @Prop({ type: Date, default: null }) judgedAt!: Date | null;
  /** Null when the problem shows only totals. */
  @Prop({ type: [ShareCaseSchema], default: null }) cases!: ShareCase[] | null;
  @Prop({ type: [ShareBatchSchema], default: null })
  batches!: ShareBatch[] | null;
  @Prop({ type: Number, default: null }) caseCount!: number | null;
  /** The compiler's output of a CE; never an internal error's text. */
  @Prop({ type: String, default: null }) compileLog!: string | null;
}
export const ShareCopySchema = SchemaFactory.createForClass(ShareCopy);

/** A staff takedown; `by` is null when the system took it down. */
@Schema({ _id: false })
export class ShareTakedown {
  @Prop({ type: Date, required: true }) at!: Date;
  @Prop({ type: UUID, default: null }) by!: string | null;
  @Prop({ default: '', maxlength: 500 }) reason!: string;
}
export const ShareTakedownSchema = SchemaFactory.createForClass(ShareTakedown);

/** An unlisted public link `/c/<code>` to a frozen copy of a submission or to pasted code. */
@Schema({ ...baseSchemaOptions, collection: 'shares' })
export class Share {
  @IdProp() _id!: string;
  @Prop({ required: true, maxlength: 32 }) code!: string;
  @Prop({ type: String, required: true, enum: SHARE_KINDS }) kind!: ShareKind;
  @Prop({ type: UUID, required: true }) createdBy!: string;
  @Prop({ default: '', maxlength: SHARE_TITLE_MAX_LENGTH }) title!: string;
  @Prop({ type: ShareLanguageSchema, required: true })
  language!: ShareLanguage;
  /** Loaded only by the reads that show it. */
  @Prop({ type: String, default: '', select: false }) source!: string;
  /** Removed by the TTL index; null never expires. */
  @Prop({ type: Date, default: null }) expiresAt!: Date | null;
  @Prop({ type: ShareTakedownSchema, default: null })
  takenDown!: ShareTakedown | null;
  /** Null for a paste. */
  @Prop({ type: ShareCopySchema, default: null }) copy!: ShareCopy | null;
  createdAt!: Date;
  updatedAt!: Date;
}

export const ShareSchema = SchemaFactory.createForClass(Share);
ShareSchema.index({ code: 1 }, { unique: true });
// A user's shares, newest first, and their active count.
ShareSchema.index({ createdBy: 1, _id: -1 });
// Mongo skips null, so links that never expire stay.
ShareSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// "Already shared": the owner's copies of one submission (not unique: a fresh copy may be taken).
ShareSchema.index(
  { createdBy: 1, 'copy.submissionId': 1 },
  { partialFilterExpression: { kind: 'submission' } },
);
