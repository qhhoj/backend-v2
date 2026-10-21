import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem } from '@libs/database';
import type { SourceCheck } from '@libs/database';
import type { SourceCheckJob } from '@libs/problems';
import type { Model } from 'mongoose';

/** Where a checked source lives and the headers stored beside it. */
export interface CheckedSource {
  code: string;
  headers: string[];
}

@Injectable()
export class SourceCheckRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** The problem's code and the headers its sources compile with, while `job.file` is still its uploaded `job.kind`; null when it was replaced or removed, or the problem is deleted. */
  async sourceIfCurrent(job: SourceCheckJob): Promise<CheckedSource | null> {
    const row = await this.problems
      .findOne(
        {
          _id: job.problemId,
          deletedAt: null,
          [`data.${job.kind}`]: job.file,
        },
        { code: 1, 'data.helperHeaders': 1 },
      )
      .lean<{ code: string; data?: { helperHeaders?: string[] } }>()
      .exec();
    return row
      ? { code: row.code, headers: row.data?.helperHeaders ?? [] }
      : null;
  }

  /** Writes the result unless the check now belongs to another upload. */
  async record(job: SourceCheckJob, check: SourceCheck): Promise<void> {
    const at = `sourceChecks.${job.kind}`;
    await this.problems
      .updateOne(
        { _id: job.problemId, [`${at}.file`]: job.file },
        { $set: { [at]: check } },
      )
      .exec();
  }
}
