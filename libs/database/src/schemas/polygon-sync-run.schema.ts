import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions, IdProp } from '../schema';
import { POLYGON_SYNC_RESULTS } from './polygon-link.schema';
import type { PolygonSyncResult } from './polygon-link.schema';

const UUID = MongooseSchema.Types.UUID;

/** Where a Polygon import job can stop: the checks before any work, the shown progress steps, the transaction, and the file moves after it. */
export const POLYGON_SYNC_STEPS = [
  'checking',
  'downloading',
  'statements',
  'generating',
  'tests',
  'saving',
  'finishing',
] as const;
export type PolygonSyncStep = (typeof POLYGON_SYNC_STEPS)[number];
/** `link`: a first import that writes the link; `sync`: a later sync of a linked problem. */
export const POLYGON_SYNC_PURPOSES = ['link', 'sync'] as const;
export type PolygonSyncPurpose = (typeof POLYGON_SYNC_PURPOSES)[number];
/** `full`: the `linux` package with every test and answer; `standard`: tests are generated on a judge. */
export const POLYGON_PACKAGE_TYPES = ['full', 'standard'] as const;
export type PolygonPackageType = (typeof POLYGON_PACKAGE_TYPES)[number];
/** `manual`: started by a user; `auto`: queued by the auto-sync job (the requester is then the linking user). */
export const POLYGON_SYNC_TRIGGERS = ['manual', 'auto'] as const;
export type PolygonSyncTrigger = (typeof POLYGON_SYNC_TRIGGERS)[number];

/** One finished Polygon import or sync job, ok or failed; written by the worker when the job ends. */
@Schema({ ...baseSchemaOptions, collection: 'polygonSyncRuns' })
export class PolygonSyncRun {
  @IdProp() _id!: string;
  /** The QHHOJ problem; null when a first import failed before creating it. */
  @Prop({ type: UUID, default: null }) problem!: string | null;
  @Prop({ required: true }) code!: string;
  @Prop({ required: true }) polygonProblemId!: number;
  @Prop({ required: true }) polygonName!: string;
  @Prop({ required: true }) revision!: number;
  @Prop({ required: true }) packageId!: number;
  @Prop({ type: Date, default: null }) packageCreatedAt!: Date | null;
  /** Which package variant the job took; `full` for runs recorded before standard packages. */
  @Prop({ type: String, default: 'full', enum: POLYGON_PACKAGE_TYPES })
  packageType!: PolygonPackageType;
  @Prop({ type: String, required: true, enum: POLYGON_SYNC_PURPOSES })
  purpose!: PolygonSyncPurpose;
  @Prop({ type: String, required: true, enum: POLYGON_SYNC_TRIGGERS })
  trigger!: PolygonSyncTrigger;
  @Prop({ type: UUID, required: true }) requestedBy!: string;
  @Prop({ required: true }) jobId!: string;
  @Prop({ type: String, required: true, enum: POLYGON_SYNC_RESULTS })
  result!: PolygonSyncResult;
  @Prop({ type: String, default: null, enum: [...POLYGON_SYNC_STEPS, null] })
  failedStep!: PolygonSyncStep | null;
  /** The error as shown to the requester ("Import failed" when it was not written for them). */
  @Prop({ type: String, default: null }) error!: string | null;
  createdAt!: Date;
}
export const PolygonSyncRunSchema =
  SchemaFactory.createForClass(PolygonSyncRun);
// Newest first (UUIDv7 ids sort by time), overall and per problem.
PolygonSyncRunSchema.index({ problem: 1, _id: -1 });
