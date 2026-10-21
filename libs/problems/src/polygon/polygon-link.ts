import type { PolygonPackageType, PolygonSyncTrigger } from '@libs/database';
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

/** One job id per problem and package, manual or automatic: BullMQ ignores an `add` whose id is still kept, so a second sync of one package joins the first instead of racing it. */
export const syncJobId = (problemId: string, packageId: number): string =>
  `polygon-sync-${problemId}-${packageId}`;
/** The ids `syncJobId` makes; every other import job has a UUIDv7 id. */
export const SYNC_JOB_ID = /^polygon-sync-[0-9a-f-]{36}-\d+$/;
