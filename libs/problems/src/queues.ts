import type { PolygonSyncStep, StatementLanguage } from '@libs/database';
import type { PolygonSource } from './polygon/polygon-link';
import type { SpentCharge } from './quota/quota.types';

export const PDF_QUEUE = 'pdf-render';
export const POLYGON_QUEUE = 'polygon-import';
/** Compiles an uploaded checker or interactor on a judge (`generate.compile`) and records the result on the problem. */
export const SOURCE_CHECK_QUEUE = 'source-compile-check';

export interface SourceCheckJob {
  problemId: string;
  kind: 'customChecker' | 'customGrader';
  /** The uploaded name; a later upload or removal makes the job a no-op. */
  file: string;
}
/** Largest Polygon package accepted, uploaded or downloaded from Polygon. */
export const POLYGON_PACKAGE_MAX_BYTES = 512 * 1024 * 1024;
/** Marks a job failure reason as written for the requester; any other reason (I/O errors with absolute paths, driver messages) stays in the logs and is never shown. */
export const POLYGON_ERROR_PREFIX = 'polygon-import: ';

/** One render per problem and language at a time: BullMQ ignores an `add` whose jobId is still queued or active. */
export const pdfJobId = (code: string, lang: StatementLanguage): string =>
  `pdf-${code}-${lang}`;

export interface PdfRenderJob {
  code: string;
  lang: StatementLanguage;
}

/** Everything the api resolved and authorised before enqueueing; the worker never re-reads request state. */
export interface PolygonImportJob {
  requesterId: string;
  code: string;
  mode: 'create' | 'update';
  /** Catalog fields: on create an absent one takes the default (oldest group and type, languages included in problems, 800 points, nobody); on update an absent one keeps the problem's current value. */
  authors?: string[];
  curators?: string[];
  groupId?: string;
  typeIds?: string[];
  points?: number;
  /** Create only: the organization the new problem is private to (api checked the creator's rights, code prefix and quota). */
  organizationId?: string;
  /** Create only: the organization whose quota meters the import (`organizationId` unless the requester is a superuser). The worker checks a downloaded package against its storage. */
  meteredOrganizationId?: string;
  /** The credits the api spent when it queued the create; the worker gives them back if the import fails before its write committed. */
  charge?: SpentCharge;
  /** Render style of the target problem (an update keeps the problem's flag). */
  isFullMarkup: boolean;
  /** Polygon statement language of the main statement; null = the only one. */
  mainStatementLanguage: string | null;
  /** Polygon language → site language for the remaining statements. */
  statementLanguages: Record<string, StatementLanguage>;
  tutorialLanguage: string | null;
  ignoreZeroPointBatches: boolean;
  ignoreZeroPointCases: boolean;
  appendMainSolution: boolean;
  /** The requester's testcase limit: 300, or 9999 with `judge.create_mass_testcases`. */
  maxCases: number;
  /** The problem's `dataVersion` when the import was queued (update only); the worker refuses if it moved since. */
  expectedDataVersion?: number;
  /** Set when the worker downloads the package from Polygon instead of reading an uploaded one; the import then writes `polygonLink`. */
  polygon?: PolygonSource;
  /** Written by the worker when the job fails: where it stopped. */
  failedStep?: PolygonSyncStep;
}

export interface PolygonImportResult {
  problemId: string;
  code: string;
}
