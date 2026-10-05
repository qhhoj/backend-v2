import type { StatementLanguage } from '@libs/database';

export const PDF_QUEUE = 'pdf-render';
export const POLYGON_QUEUE = 'polygon-import';
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
  packagePath: string;
  requesterId: string;
  code: string;
  mode: 'create' | 'update';
  /** Catalog fields: on create an absent one takes the default (oldest group and type, languages included in problems, 800 points, nobody); on update an absent one keeps the problem's current value. */
  authors?: string[];
  curators?: string[];
  groupId?: string;
  typeIds?: string[];
  allowedLanguages?: string[];
  points?: number;
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
  /** The problem's `dataVersion` when the import was queued (update only); the worker refuses if it moved since. */
  expectedDataVersion?: number;
}

export interface PolygonImportResult {
  problemId: string;
  code: string;
}
