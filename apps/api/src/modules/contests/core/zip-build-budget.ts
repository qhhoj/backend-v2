import type { RateLimitService } from '@libs/common';
import {
  CONTEST_ZIP_BUILD_LIMIT,
  CONTEST_ZIP_BUILD_WINDOW_SECONDS,
} from './rate-limits';

/** Counts one build of the contest's export or data zip; over `CONTEST_ZIP_BUILD_LIMIT` today it throws 429 and counts nothing. */
export async function claimZipBuild(
  rateLimits: RateLimitService,
  kind: 'data' | 'export',
  contestId: string,
): Promise<void> {
  await rateLimits.claim(
    [
      {
        key: `contest-${kind}:contest:${contestId}`,
        limit: CONTEST_ZIP_BUILD_LIMIT,
      },
    ],
    CONTEST_ZIP_BUILD_WINDOW_SECONDS,
  );
}
