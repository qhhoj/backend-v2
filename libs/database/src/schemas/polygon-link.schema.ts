import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { PLAIN_OBJECT } from '../schema';

const UUID = MongooseSchema.Types.UUID;
export const POLYGON_SYNC_RESULTS = ['ok', 'failed'] as const;
export type PolygonSyncResult = (typeof POLYGON_SYNC_RESULTS)[number];

/** The statement and test options of the first import; every sync re-applies them. */
@Schema({ _id: false })
export class PolygonImportOptions {
  @Prop({ type: String, default: null }) mainStatementLanguage!: string | null;
  /** Polygon language → site language (`en`|`vi`). */
  @Prop({ type: Object, default: {}, validate: PLAIN_OBJECT })
  statementLanguages!: Record<string, 'en' | 'vi'>;
  @Prop({ type: String, default: null }) tutorialLanguage!: string | null;
  @Prop({ default: false }) ignoreZeroPointBatches!: boolean;
  @Prop({ default: false }) ignoreZeroPointCases!: boolean;
  @Prop({ default: false }) appendMainSolution!: boolean;
  /** The linking user's testcase limit; an automatic sync has no requester to ask. */
  @Prop({ required: true }) maxCases!: number;
}

/** A problem imported from Polygon: where it came from and how the last sync went. Removed by an unlink; the content stays. */
@Schema({ _id: false })
export class PolygonLink {
  @Prop({ required: true }) problemId!: number;
  @Prop({ required: true }) name!: string;
  @Prop({ required: true }) owner!: string;
  /** Revision and package the problem's content was last taken from. */
  @Prop({ required: true }) revision!: number;
  @Prop({ required: true }) packageId!: number;
  @Prop({ type: Date, required: true }) linkedAt!: Date;
  /** Requester of automatic syncs (their markup permission is checked as for a manual one). */
  @Prop({ type: UUID, required: true }) linkedBy!: string;
  @Prop({ type: Date, default: null }) lastSyncAt!: Date | null;
  @Prop({ type: String, default: null, enum: [...POLYGON_SYNC_RESULTS, null] })
  lastSyncResult!: PolygonSyncResult | null;
  @Prop({ type: String, default: null }) lastSyncError!: string | null;
  /** Package of the last attempt, ok or failed: auto-sync does not retry a package that failed. */
  @Prop({ type: Number, default: null }) lastSyncPackageId!: number | null;
  @Prop({ default: false }) autoSync!: boolean;
  @Prop({
    type: SchemaFactory.createForClass(PolygonImportOptions),
    required: true,
  })
  options!: PolygonImportOptions;
}
export const PolygonLinkSchema = SchemaFactory.createForClass(PolygonLink);
