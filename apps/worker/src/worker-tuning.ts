import { STREAM_TUNING } from '@libs/common';
import { POLYGON_TUNING } from '@libs/problems';
import { DEFAULT_CONTEST_DATA_LIMITS } from './jobs/contest-data/data-zip';
import { DEFAULT_CONTEST_EXPORT_LIMITS } from './jobs/contest-export/contest-export.limits';
import { PANDOC_TUNING } from './jobs/polygon-import/pandoc.service';
import { IMPORT_TUNING } from './jobs/polygon-import/polygon-import.service';
import { DEFAULT_PACKAGE_LIMITS } from './jobs/problem-package/package-zip';
import { DEFAULT_USER_DATA_LIMITS } from './jobs/user-data/user-data.service';

/** The worker's tuning (`TUNING`), for jobs and migrations alike; specs replace parts of it through `setupWorkerTest({ tuning })`. */
export const workerTuning = {
  ...STREAM_TUNING,
  ...POLYGON_TUNING,
  ...PANDOC_TUNING,
  ...IMPORT_TUNING,
  contestDataLimits: DEFAULT_CONTEST_DATA_LIMITS,
  contestExportLimits: DEFAULT_CONTEST_EXPORT_LIMITS,
  userDataLimits: DEFAULT_USER_DATA_LIMITS,
  packageLimits: DEFAULT_PACKAGE_LIMITS,
};
export type WorkerTuning = typeof workerTuning;
