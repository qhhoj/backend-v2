import type {
  Checker,
  PolygonSyncStep,
  StatementLanguage,
  SyncedSetting,
} from '@libs/database';
import type {
  ImportErrorParams,
  PolygonImportErrorCode,
} from './polygon/polygon-import-errors';
import type { ImportOptions } from './polygon/import-options';
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
/** A Polygon import job runs twice at most: an outage it may outlast (`AUTO_RETRIED_IMPORT_ERRORS`) is retried once, two minutes later; every other failure is final. */
export const POLYGON_JOB_RETRY = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 2 * 60 * 1000 },
};
/** Automatic syncs wait behind every import and manual sync: BullMQ takes jobs without a priority first. */
export const AUTO_SYNC_PRIORITY = 10;
export const SOURCE_CHECK_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
} as const;
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
export interface PolygonImportJob extends ImportOptions {
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
  /** Create only: the organization whose quota meters the import (`organizationId` unless the requester is a superuser). The worker checks a downloaded package against its storage; an update's organization is read from the problem when the job runs. */
  meteredOrganizationId?: string;
  /** The credits the api spent when it queued the create; the worker gives them back if the import fails before its write committed. */
  charge?: SpentCharge;
  /** Render style of the target problem (an update keeps the problem's flag). */
  isFullMarkup: boolean;
  /** The problem's `dataVersion` when the import was queued (update only); the worker refuses if it moved since. */
  expectedDataVersion?: number;
  /** Sync only: replace the settings edited on QHHOJ since the last import with the package's (`SYNCED_SETTINGS`); absent keeps them. */
  overwriteLocalEdits?: boolean;
  /** Set when the worker downloads the package from Polygon instead of reading an uploaded one; the import then writes `polygonLink`. */
  polygon?: PolygonSource;
  /** Written by the worker when the job fails: where it stopped, and why as a code with its parameters. */
  failedStep?: PolygonSyncStep;
  errorCode?: PolygonImportErrorCode;
  errorParams?: ImportErrorParams;
}

/** A limit as Polygon gives it and as QHHOJ stores it: clamped to the editor's range, or the local value a sync kept (seconds, or KiB). */
export interface ClampedLimit {
  polygon: number;
  applied: number;
}

/** How the package was converted, for the setter to check against Polygon before a contest. */
export interface ImportSummary {
  /** The package's checker (`std::wcmp.cpp`, or the source path of a custom one); null for an interactive problem without one. */
  polygonChecker: string | null;
  /** What judges with it: `standard` (hcmp) or `bridged` (the package's own testlib source), for an interactive problem on what the interactor wrote; a sync that kept the local checker shows that one. */
  checker: Checker;
  interactive: boolean;
  /** An interactive problem whose checker is not run: a sync kept a local grader without `interactiveChecker`, so the interactor alone decides. */
  checkerIgnored: boolean;
  /** Distinct tests, judged cases (dependency copies counted) and batches. */
  tests: number;
  cases: number;
  batches: number;
  timeLimit: ClampedLimit;
  memoryLimit: ClampedLimit;
}

/** What a sync did with the settings the package would change: `kept` were edited on QHHOJ since the last import and stay; `updated` took the package's value (changed on Polygon, or local edits overwritten on request). Settings the package leaves as they are appear in neither. */
export interface LocalEdits {
  kept: SyncedSetting[];
  updated: SyncedSetting[];
}

export interface PolygonImportResult {
  problemId: string;
  code: string;
  /** Absent on jobs that ended before it was recorded, and on a sync another sync had already applied. */
  summary?: ImportSummary;
  /** Syncs only (absent on a first import and on jobs from before it was recorded). */
  localEdits?: LocalEdits;
  /** Set when the import committed but a file step after it failed: the problem exists and needs a repair. */
  attention?: {
    code: 'imported_needs_attention';
    params: ImportErrorParams;
    message: string;
  };
}
