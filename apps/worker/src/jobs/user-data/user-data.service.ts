import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import {
  isUserDataExpired,
  userDataPath,
  userDataTempPath,
} from '@libs/community';
import { chunkedSources, writeZipInPlace } from '../lazy-zip';
import type { ZipLimits } from '../lazy-zip';
import { UserDataRepository } from './user-data.repository';

export type UserDataLimits = ZipLimits;
export const USER_DATA_LIMITS = Symbol('USER_DATA_LIMITS');
export const DEFAULT_USER_DATA_LIMITS: UserDataLimits = {
  maxBytes: 256 * 1024 * 1024,
  maxEntries: 50_000,
  sourceChunk: 100,
};
/** The job is dropped on failure, so the status returns to `none`; the message reaches only the worker log. */
export class UserDataError extends Error {}

const json = (value: unknown) => JSON.stringify(value, null, 4);
const TEMP_FILE_AGE_MS = 86_400_000;

@Injectable()
export class UserDataService {
  constructor(
    private readonly repository: UserDataRepository,
    @Inject(ENV) private readonly env: Env,
    @Inject(USER_DATA_LIMITS) private readonly limits: UserDataLimits,
  ) {}

  /** Legacy `prepare_user_data` plus the profile (5b adds comments and blog posts). The previous zip goes first; the new one is written beside it and renamed into place. Returns the entry count. */
  async prepare(userId: string): Promise<number> {
    const root = this.root();
    const [path, temporary] = [
      userDataPath(root, userId),
      userDataTempPath(root, userId, randomUUID()),
    ];
    await mkdir(root, { recursive: true });
    await rm(path, { force: true });
    const profile = await this.repository.profile(userId);
    if (!profile) return 0;
    const submissions = await this.repository.submissionsOf(userId);
    if (submissions.length > this.limits.maxEntries)
      throw new UserDataError(
        `More than ${this.limits.maxEntries} submissions`,
      );
    const documents = [
      json(profile),
      ...(submissions.length
        ? [
            json(
              Object.fromEntries(
                submissions.map((row) => [
                  row.id,
                  {
                    problem: row.problem,
                    date: row.date.toISOString(),
                    time: row.time,
                    memory: row.memory,
                    language: row.language,
                    status: row.status,
                    result: row.result,
                    case_points: row.casePoints,
                    case_total: row.caseTotal,
                  },
                ]),
              ),
            ),
          ]
        : []),
    ];
    const names = [
      'profile.json',
      ...(submissions.length ? ['submissions/info.json'] : []),
      ...submissions.map(
        (row) =>
          `submissions/${row.id}.${row.extension.replace(/[^A-Za-z0-9]/g, '') || 'txt'}`,
      ),
    ];
    const sourceAt = chunkedSources(
      submissions.map((row) => row.id),
      this.limits.sourceChunk,
      (ids) => this.repository.sources(ids),
    );
    await writeZipInPlace(
      names,
      async (index) =>
        index < documents.length
          ? documents[index]
          : sourceAt(index - documents.length),
      path,
      temporary,
      this.limits.maxBytes,
      () => new UserDataError(`Your data passes ${this.limits.maxBytes} bytes`),
    );
    return names.length;
  }

  /** Zips past their seven days and temp files of crashed runs older than a day. Returns the files removed. */
  async sweep(now = new Date()): Promise<number> {
    const root = this.env.userDataRoot;
    if (!root) return 0;
    let removed = 0;
    for (const name of await readdir(root).catch(() => [] as string[])) {
      const path = join(root, name);
      const file = await stat(path).catch(() => null);
      if (!file) continue;
      const expired = name.endsWith('.tmp')
        ? file.mtime.getTime() + TEMP_FILE_AGE_MS <= now.getTime()
        : name.endsWith('.zip') && isUserDataExpired(file.mtime, now);
      if (expired) {
        await rm(path, { force: true });
        removed += 1;
      }
    }
    return removed;
  }

  private root(): string {
    if (!this.env.userDataRoot)
      throw new UserDataError('User data export is not configured');
    return this.env.userDataRoot;
  }
}
