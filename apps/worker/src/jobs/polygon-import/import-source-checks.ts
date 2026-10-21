import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Queue } from 'bullmq';
import type { Model } from 'mongoose';
import { CHECKED_SOURCE_KINDS, Problem } from '@libs/database';
import type {
  CheckedSourceKind,
  ProblemData,
  SourceCheck,
  SyncedSetting,
} from '@libs/database';
import { SOURCE_CHECK_JOB_OPTIONS, SOURCE_CHECK_QUEUE } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import type { ImportedProblem } from './polygon-import.repository';

/** The sync setting a checked source belongs to (see `local-edits.ts`). */
const SETTING_OF_KIND: Record<CheckedSourceKind, SyncedSetting> = {
  customChecker: 'checker',
  customGrader: 'grader',
};

const pending = (file: string): SourceCheck => ({
  file,
  status: 'pending',
  log: '',
  checkedAt: null,
});

/** The file a judge compiles alone for `kind`: the checker, or the interactor of an interactive problem. */
export function checkedFileOf(
  data: ProblemData,
  kind: CheckedSourceKind,
): string | null {
  if (kind === 'customGrader' && data.grader !== 'interactive') return null;
  return data[kind];
}

/** After an import put its files in place, the checker and interactor it wrote are compiled on a judge, as an upload in the editor is; the editor shows the result. */
@Injectable()
export class ImportSourceChecks {
  private readonly logger = new Logger(ImportSourceChecks.name);

  constructor(
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectQueue(SOURCE_CHECK_QUEUE)
    private readonly queue: Queue<SourceCheckJob>,
  ) {}

  /** A source a sync kept is not the package's, so its check stays as it was. Never throws: the import stands, and the editor shows the check as pending or the last result. */
  async checkAfterImport(
    problemId: string,
    { data, localEdits }: Pick<ImportedProblem, 'data' | 'localEdits'>,
  ): Promise<void> {
    const kept = localEdits?.kept ?? [];
    const written = CHECKED_SOURCE_KINDS.filter(
      (kind) => !kept.includes(SETTING_OF_KIND[kind]),
    ).map((kind) => ({ kind, file: checkedFileOf(data, kind) }));
    if (written.length === 0) return;
    try {
      await this.problems
        .updateOne(
          { _id: problemId },
          {
            $set: Object.fromEntries(
              written.map(({ kind, file }) => [
                `sourceChecks.${kind}`,
                file && pending(file),
              ]),
            ),
          },
        )
        .exec();
      for (const { kind, file } of written)
        if (file)
          await this.queue.add(
            SOURCE_CHECK_QUEUE,
            { problemId, kind, file },
            SOURCE_CHECK_JOB_OPTIONS,
          );
    } catch (error) {
      this.logger.warn(
        `Polygon import of ${problemId}: compile checks not queued: ${(error as Error).message}`,
      );
    }
  }
}
