import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { PLAIN_OBJECT } from '../schema';

const UUID = MongooseSchema.Types.UUID;
export const POLYGON_SYNC_RESULTS = ['ok', 'failed'] as const;
export type PolygonSyncResult = (typeof POLYGON_SYNC_RESULTS)[number];
/** What an import does with a Polygon statement other than the main one: store it as the `en` or `vi` translation, or leave it out. */
export const STATEMENT_LANGUAGE_CHOICES = ['en', 'vi', 'skip'] as const;
export type StatementLanguageChoice =
  (typeof STATEMENT_LANGUAGE_CHOICES)[number];

/** The statement and test options of the first import; every sync re-applies them. */
@Schema({ _id: false })
export class PolygonImportOptions {
  @Prop({ type: String, default: null }) mainStatementLanguage!: string | null;
  /** Polygon language → site language (`en`|`vi`), or `skip` to leave that statement out. */
  @Prop({ type: Object, default: {}, validate: PLAIN_OBJECT })
  statementLanguages!: Record<string, StatementLanguageChoice>;
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
  /** Polygon's build time of that package; null for links written before it was recorded. */
  @Prop({ type: Date, default: null }) packageCreatedAt!: Date | null;
  /** Statement title the last successful import took from the package; null for links written before it was recorded. */
  @Prop({ type: String, default: null }) title!: string | null;
  @Prop({ type: Date, required: true }) linkedAt!: Date;
  /** Requester of automatic syncs (their markup permission is checked as for a manual one). */
  @Prop({ type: UUID, required: true }) linkedBy!: string;
  @Prop({ type: Date, default: null }) lastSyncAt!: Date | null;
  @Prop({ type: String, default: null, enum: [...POLYGON_SYNC_RESULTS, null] })
  lastSyncResult!: PolygonSyncResult | null;
  @Prop({ type: String, default: null }) lastSyncError!: string | null;
  /** The last failure as a code (`PolygonImportErrorCode`) and the parameters its text needs; null after a success and on failures recorded before codes. */
  @Prop({ type: String, default: null }) lastSyncErrorCode!: string | null;
  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  lastSyncErrorParams!: Record<string, unknown> | null;
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
