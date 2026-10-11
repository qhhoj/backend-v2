import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Problem } from '@libs/database';
import type { SourceCheck } from '@libs/database';
import type { SourceCheckJob } from '@libs/problems';
import type { Model } from 'mongoose';

@Injectable()
export class SourceCheckRepository {
  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** The problem's code while `job.file` is still its uploaded `job.kind`; null when it was replaced or removed, or the problem is deleted. */
  async codeIfCurrent(job: SourceCheckJob): Promise<string | null> {
    const row = await this.problems
      .findOne(
        {
          _id: job.problemId,
          deletedAt: null,
          [`data.${job.kind}`]: job.file,
        },
        { code: 1 },
      )
      .lean<{ code: string }>()
      .exec();
    return row?.code ?? null;
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
