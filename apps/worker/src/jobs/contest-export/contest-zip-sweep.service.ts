import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { DAY_MS, ENV, isTempName } from '@libs/common';
import type { WorkerConfig } from '@libs/common';
import { CONTEST_ZIP_TTL_MS } from '@libs/contests';
import { isUuid } from '@libs/database';

/** A crashed run's temp file is surely abandoned after a day (a build is capped far below that). */
const TEMP_FILE_AGE_MS = DAY_MS;
/** `<contestId>.zip` and `<contestId>.export.zip`, as `contestDataPath` and `contestExportPath` name them; temp files too. */
const CONTEST_ZIP_NAME = /^([^.]+)(?:\.export)?\.zip$/;
/** Temp names before `atomicWrite` (`<id>.zip.<run>.tmp`); L24 removes this. */
const LEGACY_TEMP_NAME = /^([^.]+)(?:\.export)?\.zip\.[^/]+\.tmp$/;

/** How long a file of the root may stay, by its name; null for a file the sweep never touches. */
const maxAgeOf = (name: string): number | null => {
  if (isTempName(name)) return TEMP_FILE_AGE_MS;
  const legacy = LEGACY_TEMP_NAME.exec(name);
  if (legacy && isUuid(legacy[1])) return TEMP_FILE_AGE_MS;
  const match = CONTEST_ZIP_NAME.exec(name);
  return match && isUuid(match[1]) ? CONTEST_ZIP_TTL_MS : null;
};

@Injectable()
export class ContestZipSweepService {
  constructor(@Inject(ENV) private readonly env: WorkerConfig) {}

  /** Export and data zips past their week and temp files of crashed runs older than a day; any other file in the root is left alone. Returns the files removed. */
  async sweep(now = new Date()): Promise<number> {
    const root = this.env.contestDataRoot;
    if (!root) return 0;
    let removed = 0;
    for (const name of await readdir(root).catch(() => [] as string[])) {
      const maxAge = maxAgeOf(name);
      if (maxAge === null) continue;
      const path = join(root, name);
      const file = await stat(path).catch(() => null);
      if (file && file.mtime.getTime() + maxAge <= now.getTime()) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }
}
