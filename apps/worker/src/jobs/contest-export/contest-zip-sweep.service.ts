import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { CONTEST_ZIP_TTL_MS } from '@libs/contests';
import { isUuid } from '@libs/database';

/** A crashed run's temp file is surely abandoned after a day (a build is capped far below that). */
const TEMP_FILE_AGE_MS = 86_400_000;
/** `<contestId>.zip`, `<contestId>.export.zip` and their `.<runId>.tmp` files, as `contestDataPath`, `contestExportPath` and their temp paths name them. */
const CONTEST_ZIP_NAME = /^([^.]+)(?:\.export)?\.zip(\.[^/]+\.tmp)?$/;

/** How long a file of the root may stay, by its name; null for a file the sweep never touches. */
const maxAgeOf = (name: string): number | null => {
  const match = CONTEST_ZIP_NAME.exec(name);
  if (!match || !isUuid(match[1])) return null;
  return match[2] ? TEMP_FILE_AGE_MS : CONTEST_ZIP_TTL_MS;
};

@Injectable()
export class ContestZipSweepService {
  constructor(@Inject(ENV) private readonly env: Env) {}

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
