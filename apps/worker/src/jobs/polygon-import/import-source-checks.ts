import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import type { Model } from 'mongoose';
import { CHECKED_SOURCE_KINDS, Problem } from '@libs/database';
import type { ProblemData, SourceCheck, SourceChecks } from '@libs/database';
import { SOURCE_CHECK_JOB_OPTIONS, SOURCE_CHECK_QUEUE } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';

const pending = (file: string): SourceCheck => ({
  file,
  status: 'pending',
  log: '',
  checkedAt: null,
});

/** The checker, and the interactor of an interactive problem: the sources a judge compiles alone. */
export function checkedSourcesOf(data: ProblemData): SourceChecks {
  const interactor = data.grader === 'interactive' ? data.customGrader : null;
  return {
    customChecker: data.customChecker ? pending(data.customChecker) : null,
    customGrader: interactor ? pending(interactor) : null,
  };
}

/** After an import put its files in place, its checker and interactor are compiled on a judge, as an upload in the editor is; the editor shows the result. */
@Injectable()
export class ImportSourceChecks {
  private readonly logger = new Logger(ImportSourceChecks.name);

  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectQueue(SOURCE_CHECK_QUEUE)
    private readonly queue: Queue<SourceCheckJob>,
  ) {}

  /** Never throws: the import stands, and the editor shows the check as pending or the last result. */
  async checkAfterImport(problemId: string, data: ProblemData): Promise<void> {
    const checks = checkedSourcesOf(data);
    try {
      await this.problems
        .updateOne({ _id: problemId }, { $set: { sourceChecks: checks } })
        .exec();
      for (const kind of CHECKED_SOURCE_KINDS) {
        const file = checks[kind]?.file;
        if (file)
          await this.queue.add(
            SOURCE_CHECK_QUEUE,
            { problemId, kind, file },
            SOURCE_CHECK_JOB_OPTIONS,
          );
      }
    } catch (error) {
      this.logger.warn(
        `Polygon import of ${problemId}: compile checks not queued: ${(error as Error).message}`,
      );
    }
  }
}
