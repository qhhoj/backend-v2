import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp, PLAIN_OBJECT } from '../schema';

const Mixed = MongooseSchema.Types.Mixed;
const ObjectId = MongooseSchema.Types.ObjectId;

/** `queued` until a judge takes it, `running` on that judge, then `done` (result uploaded) or `failed`. */
export const TEST_GENERATION_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
] as const;
export type TestGenerationStatus = (typeof TEST_GENERATION_STATUSES)[number];

/** Where a generation stopped and why, as the judge (or the bridge, for job-level failures) reported it. */
export interface TestGenerationFailure {
  /** `COMPILE` | `GENERATE` | `VALIDATE` | `SOLVE` | `JOB` (the proto Stage without its prefix). */
  stage: string;
  /** `COMPILE_ERROR` | `CRASHED` | `TIME_LIMIT` | ... (the proto Kind without its prefix). */
  kind: string;
  program: string;
  /** 1-based test index, 0 when not about one test. */
  testIndex: number;
  detail: string;
}

/**
 * One "generate tests" job for a Polygon standard package: the worker inserts it with the plan and the GridFS
 * bundle, the bridge runs it on a judge with feature `generate.polygon` and stores the result zip in GridFS.
 * Bundle and result live in the `testGenerations` GridFS bucket and are removed with the row.
 */
@Schema({ ...baseSchemaOptions, collection: 'testGenerations' })
export class TestGeneration {
  @IdProp() _id!: string;
  @Prop({ type: String, required: true, enum: TEST_GENERATION_STATUSES })
  status!: TestGenerationStatus;
  /** `GenerationPlan` from `@libs/judging`: programs, tests, limits, file I/O, deadline. */
  @Prop({ type: Mixed, required: true, validate: PLAIN_OBJECT })
  plan!: Record<string, unknown>;
  @Prop({ type: ObjectId, required: true }) bundleFileId!: unknown;
  @Prop({ required: true }) bundleSize!: number;
  @Prop({ type: ObjectId, default: null }) resultFileId!: unknown;
  /** The judge and session running it; null while queued. */
  @Prop({ type: String, default: null }) judge!: string | null;
  @Prop({ type: String, default: null }) sessionId!: string | null;
  @Prop({ type: Date, default: null }) startedAt!: Date | null;
  @Prop({ type: Date, default: null }) endedAt!: Date | null;
  @Prop({ type: Mixed, default: null }) failure!: TestGenerationFailure | null;
  createdAt!: Date;
}
export const TestGenerationSchema =
  SchemaFactory.createForClass(TestGeneration);
TestGenerationSchema.index({ status: 1, _id: 1 });
