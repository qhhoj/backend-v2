import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';

export const CHECKERS = [
  'standard',
  'bridged',
  'floats',
  'floatsabs',
  'floatsrel',
  'identical',
  'linecount',
  'rstripped',
  'sorted',
  'unordered',
  'easy',
  'linematches',
] as const;
export type Checker = (typeof CHECKERS)[number];
export const GRADERS = [
  'standard',
  'interactive',
  'signature',
  'output_only',
] as const;
export type Grader = (typeof GRADERS)[number];
export const CUSTOM_CHECKER_TYPES = [
  'themis',
  'testlib',
  'cms',
  'coci',
  'peg',
  'default',
] as const;
export type CustomCheckerType = (typeof CUSTOM_CHECKER_TYPES)[number];
export const CASE_TYPES = ['C', 'S', 'E'] as const;
export type CaseType = (typeof CASE_TYPES)[number];
export const DATA_FILE_KINDS = [
  'archive',
  'generator',
  'customChecker',
  'customGrader',
  'customHeader',
] as const;
/** Per-case override: any checker except `bridged`, which needs the problem's custom checker file. */
export const CASE_CHECKERS = [
  '',
  'standard',
  'floats',
  'floatsabs',
  'floatsrel',
  'identical',
  'linecount',
  'rstripped',
  'sorted',
  'unordered',
  'easy',
  'linematches',
] as const;
export type CaseChecker = (typeof CASE_CHECKERS)[number];
export type DataFileKind = (typeof DATA_FILE_KINDS)[number];
export type JsonObject = Record<string, unknown>;

const Mixed = MongooseSchema.Types.Mixed;

@Schema({ _id: false })
export class ProblemTestCase {
  @Prop({ type: String, required: true, enum: CASE_TYPES }) type!: CaseType;
  @Prop({ default: '', maxlength: 100 }) input!: string;
  @Prop({ default: '', maxlength: 100 }) output!: string;
  @Prop({ type: Number, default: null }) points!: number | null;
  @Prop({ default: false }) isPretest!: boolean;
  @Prop({ default: '' }) generatorArgs!: string;
  @Prop({ type: String, default: '', enum: CASE_CHECKERS })
  checker!: CaseChecker;
  @Prop({ type: Mixed, default: null }) checkerArgs!: JsonObject | null;
  @Prop({ type: Number, default: null }) outputPrefix!: number | null;
  @Prop({ type: Number, default: null }) outputLimit!: number | null;
}
export const ProblemTestCaseSchema =
  SchemaFactory.createForClass(ProblemTestCase);

/** Legacy `ProblemData` + `ProblemTestCase` rows, embedded; file fields hold bare names inside `<PROBLEM_DATA_ROOT>/<code>/`. */
@Schema({ _id: false })
export class ProblemData {
  @Prop({ type: String, default: null }) archive!: string | null;
  @Prop({ type: String, default: null }) generator!: string | null;
  @Prop({ type: String, default: null }) customChecker!: string | null;
  @Prop({ type: String, default: null }) customGrader!: string | null;
  @Prop({ type: String, default: null }) customHeader!: string | null;
  /** Headers a Polygon package ships (its own testlib.h included), stored beside its checker and interactor, which compile with them. */
  @Prop({ type: [String], default: [] }) helperHeaders!: string[];
  /** An interactive problem also runs its checker on what the interactor wrote (Polygon's model); false keeps the legacy rule that the interactor alone decides. */
  @Prop({ default: false }) interactiveChecker!: boolean;
  @Prop({ type: String, default: 'standard', enum: CHECKERS })
  checker!: Checker;
  @Prop({ type: Mixed, default: null }) checkerArgs!: JsonObject | null;
  @Prop({ type: String, default: 'standard', enum: GRADERS }) grader!: Grader;
  @Prop({ type: Mixed, default: null }) graderArgs!: JsonObject | null;
  @Prop({ type: Number, default: null }) outputPrefix!: number | null;
  @Prop({ type: Number, default: null }) outputLimit!: number | null;
  @Prop({ default: false }) unicode!: boolean;
  @Prop({ default: false }) nobigmath!: boolean;
  /** Last init.yml generation error; empty when the file was written. */
  @Prop({ default: '' }) feedback!: string;
  @Prop({ type: [ProblemTestCaseSchema], default: [] })
  cases!: ProblemTestCase[];
}
export const ProblemDataSchema = SchemaFactory.createForClass(ProblemData);

/** `pending` until the worker compiled the file on a judge; `unavailable` when no judge could (none online with `generate.compile`, or the run was lost). */
export const SOURCE_CHECK_STATUSES = [
  'pending',
  'ok',
  'error',
  'unavailable',
] as const;
export type SourceCheckStatus = (typeof SOURCE_CHECK_STATUSES)[number];
/** Uploads compiled on a judge right after the upload: the checker, and the interactor of an interactive problem. */
export const CHECKED_SOURCE_KINDS = ['customChecker', 'customGrader'] as const;
export type CheckedSourceKind = (typeof CHECKED_SOURCE_KINDS)[number];

/** The compile check of one uploaded source, for the file named `file`. */
@Schema({ _id: false })
export class SourceCheck {
  @Prop({ required: true }) file!: string;
  @Prop({ type: String, required: true, enum: SOURCE_CHECK_STATUSES })
  status!: SourceCheckStatus;
  /** Compile log of an `error`, reason of an `unavailable`; empty otherwise. */
  @Prop({ default: '' }) log!: string;
  @Prop({ type: Date, default: null }) checkedAt!: Date | null;
}
export const SourceCheckSchema = SchemaFactory.createForClass(SourceCheck);

@Schema({ _id: false })
export class SourceChecks {
  @Prop({ type: SourceCheckSchema, default: null })
  customChecker!: SourceCheck | null;
  @Prop({ type: SourceCheckSchema, default: null })
  customGrader!: SourceCheck | null;
}
export const SourceChecksSchema = SchemaFactory.createForClass(SourceChecks);

/** A plain case row; batch markers and real cases override its fields. */
export const EMPTY_TEST_CASE: Readonly<ProblemTestCase> = Object.freeze({
  type: 'C',
  input: '',
  output: '',
  points: null,
  isPretest: false,
  generatorArgs: '',
  checker: '',
  checkerArgs: null,
  outputPrefix: null,
  outputLimit: null,
});

/** Every file in the data directory a configuration names. */
export const dataFileNamesOf = (
  data: Pick<ProblemData, DataFileKind | 'helperHeaders'>,
): string[] => [
  ...DATA_FILE_KINDS.flatMap((kind) => data[kind] ?? []),
  ...(data.helperHeaders ?? []),
];

export const emptyProblemData = (): ProblemData => ({
  archive: null,
  generator: null,
  customChecker: null,
  customGrader: null,
  customHeader: null,
  helperHeaders: [],
  interactiveChecker: false,
  checker: 'standard',
  checkerArgs: null,
  grader: 'standard',
  graderArgs: null,
  outputPrefix: null,
  outputLimit: null,
  unicode: false,
  nobigmath: false,
  feedback: '',
  cases: [],
});
