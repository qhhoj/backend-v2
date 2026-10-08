import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { SUBMISSION_RESULTS, type SubmissionResult } from './submission.schema';

const UUID = MongooseSchema.Types.UUID;

export const SIMILARITY_SCOPES = ['problem', 'contest'] as const;
export type SimilarityScope = (typeof SIMILARITY_SCOPES)[number];
export const SIMILARITY_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
] as const;
export type SimilarityStatus = (typeof SIMILARITY_STATUSES)[number];
export const SIMILARITY_TOKENIZERS = ['syntax', 'text'] as const;
export type SimilarityTokenizerName = (typeof SIMILARITY_TOKENIZERS)[number];

const RESULTS_WITHOUT_SIGNAL: readonly SubmissionResult[] = [
  'CE',
  'IE',
  'AB',
  'RJ',
];
/** Results whose source is compared: it compiled and ran, or was judged on its merits. An unjudged submission (`result: null`) is never in this list, so it is never compared. */
export const SIMILARITY_RESULTS: readonly SubmissionResult[] =
  SUBMISSION_RESULTS.filter(
    (result) => !RESULTS_WITHOUT_SIGNAL.includes(result),
  );

/** What one (problem, language family) comparison saw; the viewer shows it so a skipped or truncated group is never silent. */
@Schema({ _id: false })
export class SimilarityGroup {
  @Prop({ type: UUID, required: true }) problem!: string;
  /** Engine family name: `cpp`, `python`, ... (C++03 to C++20 are one family). */
  @Prop({ required: true }) language!: string;
  @Prop({ type: String, required: true, enum: SIMILARITY_TOKENIZERS })
  tokenizer!: SimilarityTokenizerName;
  /** Submissions of the family in scope, before the cap. */
  @Prop({ default: 0, min: 0 }) submissionCount!: number;
  /** Sent to the engine: after the cap and the empty/oversize skips. */
  @Prop({ default: 0, min: 0 }) comparedCount!: number;
  @Prop({ default: 0, min: 0 }) skippedEmpty!: number;
  @Prop({ default: 0, min: 0 }) skippedTooLarge!: number;
  /** More than `limits.maxSubmissions` submissions: only the newest were compared. */
  @Prop({ default: false }) truncated!: boolean;
  @Prop({ default: 0, min: 0 }) pairCount!: number;
}
export const SimilarityGroupSchema =
  SchemaFactory.createForClass(SimilarityGroup);

/** A judge language with no grammar, skipped. */
@Schema({ _id: false })
export class SimilarityUnsupported {
  /** `Language.commonName`. */
  @Prop({ required: true }) language!: string;
  @Prop({ default: 0, min: 0 }) submissionCount!: number;
}
export const SimilarityUnsupportedSchema = SchemaFactory.createForClass(
  SimilarityUnsupported,
);

/** The limits in force when the run started (settings are read once, by the api). */
@Schema({ _id: false })
export class SimilarityLimits {
  @Prop({ required: true, min: 1, max: 100 }) minPercent!: number;
  @Prop({ required: true, min: 1 }) maxPairs!: number;
  @Prop({ required: true, min: 2 }) maxSubmissions!: number;
}
export const SimilarityLimitsSchema =
  SchemaFactory.createForClass(SimilarityLimits);

@Schema({ ...baseSchemaOptions, collection: 'similarityRuns' })
export class SimilarityRun {
  @IdProp() _id!: string;
  @Prop({ type: String, required: true, enum: SIMILARITY_SCOPES })
  scope!: SimilarityScope;
  /** `problem:<id>` or `contest:<id>`: the unit that has at most one active run. */
  @Prop({ required: true }) scopeKey!: string;
  @Prop({ type: UUID, default: null }) problem!: string | null;
  @Prop({ type: UUID, default: null }) contest!: string | null;
  @Prop({ type: UUID, required: true }) requestedBy!: string;
  @Prop({ type: String, default: 'queued', enum: SIMILARITY_STATUSES })
  status!: SimilarityStatus;
  /** `queued` or `running`; the partial unique index below lets a scope hold one such run. */
  @Prop({ default: true }) active!: boolean;
  @Prop({ type: Date, default: null }) startedAt!: Date | null;
  @Prop({ type: Date, default: null }) finishedAt!: Date | null;
  /** `deadline`, `engine_failed`, `internal_error` or `abandoned` (never a raw message). */
  @Prop({ type: String, default: null }) error!: string | null;
  @Prop({ type: SimilarityLimitsSchema, required: true })
  limits!: SimilarityLimits;
  @Prop({ type: [SimilarityGroupSchema], default: [] })
  groups!: SimilarityGroup[];
  @Prop({ type: [SimilarityUnsupportedSchema], default: [] })
  unsupported!: SimilarityUnsupported[];
  createdAt!: Date;
}

export const SimilarityRunSchema = SchemaFactory.createForClass(SimilarityRun);
SimilarityRunSchema.index(
  { scopeKey: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
SimilarityRunSchema.index({ scopeKey: 1, _id: -1 });
