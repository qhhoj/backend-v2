import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import {
  ProblemDataFilesService,
  QUOTA_BACKFILL_DONE_KEY,
} from '@libs/problems';
import { ProblemDataBytesRepository } from './problem-databytes.repository';
import type { MeasuredSize, ProblemRef } from './problem-databytes.repository';

const BATCH = 200;

/** Recompute-and-set of `problems.dataBytes` from disk. Runs once before `quota.enforce` is ever switched on, so organizations are not judged on zeros. It takes no data lock (a read must not stall the judge): it tolerates concurrent writes by compare-and-set, see `setSizes`. */
@Injectable()
export class ProblemDataBytesService {
  private readonly logger = new Logger(ProblemDataBytesService.name);

  constructor(
    private readonly repository: ProblemDataBytesRepository,
    private readonly dataFiles: ProblemDataFilesService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async backfill(): Promise<{ problems: number; bytes: number }> {
    let problems = 0;
    let bytes = 0;
    for await (const batch of this.repository.batches(BATCH)) {
      const sizes = await Promise.all(batch.map((ref) => this.measure(ref)));
      await this.repository.setSizes(sizes);
      problems += sizes.length;
      bytes += sizes.reduce((sum, size) => sum + size.bytes, 0);
    }
    await this.redis.set(QUOTA_BACKFILL_DONE_KEY, '1');
    this.logger.log(`dataBytes backfill: ${problems} problems, ${bytes} bytes`);
    return { problems, bytes };
  }

  /** A stored code that is not a valid directory name (legacy data) has no directory: 0. A disk error propagates, so the job retries instead of recording a wrong 0. */
  private async measure(ref: ProblemRef): Promise<MeasuredSize> {
    if (!PROBLEM_CODE_PATTERN.test(ref.code)) return { ref, bytes: 0 };
    return { ref, bytes: await this.dataFiles.bytesOf(ref.code) };
  }
}
