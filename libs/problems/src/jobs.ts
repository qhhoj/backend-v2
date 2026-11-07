import type {
  Checker,
  PolygonPackageType,
  PolygonSyncStep,
  PolygonSyncTrigger,
  StatementLanguage,
  SyncedSetting,
} from '@libs/database';
import {
  DAY_MS,
  defineJob,
  JOB_RETENTION,
  JOB_RETRY,
  MINUTE_MS,
  SCHEDULED_RETENTION,
} from '@libs/common';
import type {
  ImportErrorParams,
  PolygonImportErrorCode,
} from './polygon/polygon-import-errors';
import type { ImportOptions } from './polygon/import-options';
import type { SpentCharge } from './quota/quota.types';

export interface PdfRenderJob {
  code: string;
  lang: StatementLanguage;
}

export interface SourceCheckJob {
  problemId: string;
  kind: 'customChecker' | 'customGrader';
  /** The uploaded name; a later upload or removal makes the job a no-op. */
  file: string;
}

export type SolversRecomputeReason = 'deleted' | 'restored';
/** Recompute the points of every user with a submission to the problem, after it was deleted or restored (deleted problems do not count for points). */
export interface ProblemSolversJob {
  problemId: string;
  reason: SolversRecomputeReason;
}

/** Remove the problem's heavy assets and leave a tombstone; submissions stay. */
export interface ProblemPurgeJob {
  problemId: string;
}

/** `key` names the exact content the api saw (`<dataVersion>.<contentHash>`). */
export interface ProblemPackageJob {
  code: string;
  key: string;
}
/** The `JobFailure` of a build over the size cap; the api turns it into `409 package_too_large`. */
export const PACKAGE_TOO_LARGE = 'too_large';

/** Everything the api resolved and authorised before enqueueing; the worker never re-reads request state. */
export interface PolygonImportJob extends ImportOptions {
  requesterId: string;
  code: string;
  mode: 'create' | 'update';
  /** Update only: the id of the problem the job writes; reads and history follow it, not the code (a rename frees the code for another problem). */
  problemId?: string;
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

/** Steps of an import job, in order; `queued`, `done` and `failed` come from the job state, the rest from its progress. */
export const IMPORT_STEPS = [
  'queued',
  'downloading',
  'statements',
  'generating',
  'tests',
  'done',
  'failed',
] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];
/** What the worker reports while a job runs; `done`/`total` count bytes while downloading and are null otherwise. */
export interface ImportProgress {
  step: Extract<
    ImportStep,
    'downloading' | 'statements' | 'generating' | 'tests'
  >;
  done: number | null;
  total: number | null;
}

/** The Polygon package an import downloads itself (instead of an uploaded zip), and the link it writes on success. */
export interface PolygonSource {
  problemId: number;
  name: string;
  owner: string;
  revision: number;
  packageId: number;
  /** Which variant to download: `full` (`linux`, tests included) or `standard` (tests generated on a judge); absent on jobs queued before standard packages, which are full. */
  packageType?: PolygonPackageType;
  /** Polygon's build time of the package (ISO); absent on jobs queued before it was recorded. */
  packageCreatedAt?: string | null;
  /** `link`: a first import, which (re)writes the whole link; `sync`: refreshes the revision and sync fields of the existing link. */
  purpose: 'link' | 'sync';
  /** Written on `link` only; a sync keeps the link's switch. */
  autoSync: boolean;
  /** Who started it, for the sync history; absent (manual) on jobs queued before it was recorded. */
  trigger?: PolygonSyncTrigger;
}

/** One job id per problem and package, manual or automatic: BullMQ ignores an `add` whose id is still kept, so a second sync of one package joins the first instead of racing it. Every other import job has a UUIDv7 id. */
export const syncJobId = (problemId: string, packageId: number): string =>
  `polygon-sync-${problemId}-${packageId}`;
/** The ids `syncJobId` makes. */
export const SYNC_JOB_ID = /^polygon-sync-[0-9a-f-]{36}-\d+$/;

/** A Polygon import job runs twice at most: an outage it may outlast (`AUTO_RETRIED_IMPORT_ERRORS`) is retried once, two minutes later; every other failure is final. A finished job stays readable (and blocks a duplicate of the same package) for a day, so the staff member can see its outcome. */
const POLYGON_IMPORT_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed', delay: 2 * MINUTE_MS },
  removeOnComplete: { age: DAY_MS / 1000 },
  removeOnFail: { age: DAY_MS / 1000 },
};
/** The failure reason of an import written for the requester; any other reason (I/O errors with absolute paths, driver messages) stays in the logs and is never shown. */
const POLYGON_IMPORT_FAILURE = 'polygon-import: ';
/** A failed render or package build is kept this long: polls answer 503 meanwhile, then a request builds again. */
const ON_DEMAND_FAIL_WINDOW_SECONDS = 10 * 60;

/** The problems' jobs. None waits for indexes, and none is limited across worker processes. */
export const problemJobs = {
  /** One render per problem and language at a time (`onDemandState`). */
  pdf: defineJob<PdfRenderJob>({
    queue: 'pdf-render',
    name: 'render',
    options: {
      removeOnComplete: true,
      removeOnFail: { age: ON_DEMAND_FAIL_WINDOW_SECONDS },
    },
    jobId: ({ code, lang }) => `pdf-${code}-${lang}`,
    describe: ({ code, lang }) => `PDF ${code}.${lang}`,
  }),
  /** An upload, a link import or a manual sync, queued by the api under a UUIDv7 or `syncJobId`. One at a time per worker process. */
  polygonImport: defineJob<PolygonImportJob>({
    queue: 'polygon-import',
    name: 'import',
    options: POLYGON_IMPORT_OPTIONS,
    describe: ({ code }) => `Polygon import of ${code}`,
    failurePrefix: POLYGON_IMPORT_FAILURE,
  }),
  /** An automatic sync: waits behind every import and manual sync (BullMQ takes jobs without a priority first), and a manual sync of the same package replaces it while it is delayed (`preempt`). */
  autoSyncImport: defineJob<PolygonImportJob>({
    queue: 'polygon-import',
    name: 'sync',
    options: { ...POLYGON_IMPORT_OPTIONS, priority: 10 },
    jobId: ({ problemId, polygon }) =>
      syncJobId(problemId ?? '', polygon?.packageId ?? 0),
    describe: ({ code }) => `Polygon import of ${code}`,
    failurePrefix: POLYGON_IMPORT_FAILURE,
  }),
  /** Queues an automatic sync of each linked problem whose Polygon package moved on. */
  autoSync: defineJob<void>({
    queue: 'polygon-autosync',
    name: 'polygon-autosync',
    options: { ...JOB_RETRY, ...SCHEDULED_RETENTION },
    describe: () => 'Polygon auto-sync',
    schedule: {
      id: 'polygon-autosync-every-10-minutes',
      pattern: '*/10 * * * *',
      tz: 'site',
    },
  }),
  /** Compiles an uploaded checker or interactor on a judge (`generate.compile`) and records the result on the problem. Each check holds a judge slot for seconds; two at a time leaves the judges to submissions. The job name is the queue's. */
  sourceCheck: defineJob<SourceCheckJob>({
    queue: 'source-compile-check',
    name: 'source-compile-check',
    options: { removeOnComplete: true, removeOnFail: 100 },
    describe: ({ kind, file }) => `Compile check of ${kind} ${file}`,
    concurrency: 2,
  }),
  /** No job id: a delete followed by a restore must queue both. The effects sweep and the next graded submission recompute a user anyway. */
  solvers: defineJob<ProblemSolversJob>({
    queue: 'problem-solvers-recompute',
    name: 'recompute',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ problemId, reason }) =>
      `Recompute for the solvers of problem ${problemId} (${reason})`,
  }),
  /** One job per problem at a time (`addReplacingFailed`). One purge at a time per worker process: it deletes directories and thousands of rows. */
  purge: defineJob<ProblemPurgeJob>({
    queue: 'problem-purge',
    name: 'purge',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    jobId: ({ problemId }) => `problem-purge-${problemId}`,
    describe: ({ problemId }) => `Purge of problem ${problemId}`,
  }),
  /** Daily: queues a purge of each problem deleted longer ago than `problem.deleteGraceDays`. */
  purgeSweep: defineJob<void>({
    queue: 'problem-purge',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'Problem purge sweep',
    schedule: { id: 'problem-purge-daily', pattern: '30 3 * * *', tz: 'site' },
  }),
  /** One build per problem and content key (`onDemandState`; BullMQ ids cannot contain `:`), one at a time per worker process: disk and memory. */
  package: defineJob<ProblemPackageJob>({
    queue: 'problem-package',
    name: 'build',
    options: {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { age: ON_DEMAND_FAIL_WINDOW_SECONDS },
    },
    jobId: ({ code, key }) => `package-${code}-${key}`,
    describe: ({ code }) => `Package of ${code}`,
    failurePrefix: 'problem-package: ',
  }),
  /** Daily: drops the cached packages nobody asked for in a day. */
  packageSweep: defineJob<void>({
    queue: 'problem-package',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'Package cache sweep',
    schedule: {
      id: 'problem-package-sweep-daily',
      pattern: '15 4 * * *',
      tz: 'site',
    },
  }),
};
