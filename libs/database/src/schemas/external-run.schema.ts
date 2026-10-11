import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { baseSchemaOptions } from '../schema';

const UUID = MongooseSchema.Types.UUID;

/** The remote side of a submission's current run on the external judge; `_id` is the submission id, and every claim replaces the document. Read by the bridge after a restart and by staff on the submission page. */
@Schema({ ...baseSchemaOptions, collection: 'externalRuns' })
export class ExternalRun {
  @Prop({ type: UUID, required: true }) _id!: string;
  /** The submission's `judgeGeneration` of this run: a rejudge makes it stale. */
  @Prop({ required: true }) generation!: number;
  @Prop({ required: true }) oj!: string;
  @Prop({ required: true }) problemId!: string;
  @Prop({ required: true }) remoteLanguage!: string;
  /** The external judge's submission id; null until the submit was answered. */
  @Prop({ type: String, default: null }) remoteId!: string | null;
  @Prop({ default: '' }) systemStatus!: string;
  @Prop({ default: '' }) statusCanonical!: string;
  @Prop({ type: String, default: null }) remoteUrl!: string | null;
  @Prop({ type: String, default: null }) scoreText!: string | null;
  @Prop({ type: Number, default: null }) runtimeMs!: number | null;
  @Prop({ type: Number, default: null }) memoryKb!: number | null;
  @Prop({ type: Date, default: null }) submittedAt!: Date | null;
  @Prop({ type: Date, default: null }) lastPolledAt!: Date | null;
  /** Failed polls in a row; drives the backoff. */
  @Prop({ default: 0 }) pollErrors!: number;
}

export const ExternalRunSchema = SchemaFactory.createForClass(ExternalRun);
