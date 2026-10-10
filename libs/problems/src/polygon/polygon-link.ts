/** Repeatable worker job that queues a sync for linked problems whose Polygon package moved on. */
export const POLYGON_AUTOSYNC_QUEUE = 'polygon-autosync';
export const POLYGON_AUTOSYNC_JOB = 'polygon-autosync';
export const POLYGON_AUTOSYNC_SCHEDULER = 'polygon-autosync-every-10-minutes';
export const POLYGON_AUTOSYNC_PATTERN = '*/10 * * * *';

/** Steps of an import job, in order; `queued`, `done` and `failed` come from the job state, the rest from its progress. */
export const IMPORT_STEPS = [
  'queued',
  'downloading',
  'statements',
  'tests',
  'done',
  'failed',
] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];
/** What the worker reports while a job runs; `done`/`total` count bytes while downloading and are null otherwise. */
export interface ImportProgress {
  step: Extract<ImportStep, 'downloading' | 'statements' | 'tests'>;
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
  /** `link`: a first import, which (re)writes the whole link; `sync`: refreshes the revision and sync fields of the existing link. */
  purpose: 'link' | 'sync';
  /** Written on `link` only; a sync keeps the link's switch. */
  autoSync: boolean;
}

/** BullMQ ignores an `add` whose id is still kept, so one package is synced at most once per kept job. */
export const autoSyncJobId = (problemId: string, packageId: number): string =>
  `polygon-sync-${problemId}-${packageId}`;
