import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS, StorageService } from '@libs/common';
import { PROBLEM_CODE_PATTERN } from '@libs/database';
import {
  ProblemDataFilesService,
  QUOTA_BACKFILL_DONE_KEY,
} from '@libs/problems';
import { ProblemDataBytesRepository } from './problem-databytes.repository';
import type {
  MeasuredSize,
  ProblemRef,
  StoredFile,
} from './problem-databytes.repository';

const BATCH = 200;

/** Recompute-and-set of `problems.dataBytes` (the data directory) and of `pdfStatementBytes` / `materialBytes` (the uploaded files) from disk. Runs once before `quota.enforce` is ever switched on, so organizations are not judged on zeros. It takes no data lock (a read must not stall the judge): it tolerates concurrent writes by compare-and-set, see `setSizes`. */
@Injectable()
export class ProblemDataBytesService {
  private readonly logger = new Logger(ProblemDataBytesService.name);

  constructor(
    private readonly repository: ProblemDataBytesRepository,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async backfill(): Promise<{ problems: number; bytes: number }> {
    let problems = 0;
    let bytes = 0;
    for await (const batch of this.repository.batches(BATCH)) {
      const sizes = await Promise.all(batch.map((ref) => this.measure(ref)));
      await this.repository.setSizes(sizes);
      problems += sizes.length;
      bytes += sizes.reduce(
        (sum, size) =>
          sum + size.bytes + size.pdfStatementBytes + size.materialBytes,
        0,
      );
    }
    await this.redis.set(QUOTA_BACKFILL_DONE_KEY, '1');
    this.logger.log(`dataBytes backfill: ${problems} problems, ${bytes} bytes`);
    return { problems, bytes };
  }

  /** A disk error propagates, so the job retries instead of recording a wrong 0. */
  private async measure(ref: ProblemRef): Promise<MeasuredSize> {
    return {
      ref,
      bytes: await this.dataDirectoryBytes(ref.code),
      pdfStatementBytes: await this.fileBytes(ref.pdfStatement, 'pdf'),
      materialBytes: await this.fileBytes(ref.material, 'materials'),
    };
  }

  /** A stored code that is not a valid directory name (legacy data) has no directory: 0. */
  private dataDirectoryBytes(code: string): Promise<number> {
    return PROBLEM_CODE_PATTERN.test(code)
      ? this.dataFiles.bytesOf(code)
      : Promise.resolve(0);
  }

  /** Only a file in our media layout is measured; an external link or none is 0. */
  private fileBytes(
    file: StoredFile,
    kind: 'pdf' | 'materials',
  ): Promise<number> {
    const relativePath = this.storage.relativePathOf(file.url, kind);
    return relativePath === null
      ? Promise.resolve(0)
      : this.storage.bytesOf(relativePath);
  }
}
