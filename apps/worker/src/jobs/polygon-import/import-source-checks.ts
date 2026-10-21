import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CHECKED_SOURCE_KINDS } from '@libs/database';
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

type WrittenSources = Pick<ImportedProblem, 'data' | 'localEdits'>;

/** Each checked kind whose source the import wrote, with the file a judge compiles (null: none). A source a sync kept is not the package's, so it is left out. */
function writtenSources({ data, localEdits }: WrittenSources) {
  const kept = localEdits?.kept ?? [];
  return CHECKED_SOURCE_KINDS.filter(
    (kind) => !kept.includes(SETTING_OF_KIND[kind]),
  ).map((kind) => ({ kind, file: checkedFileOf(data, kind) }));
}

/** The compile check state an import writes in its own transaction, so no result of a replaced file outlives the commit: `pending` for each source it wrote, null where it wrote none; a kept source keeps its check. */
export function importedSourceChecks(
  imported: WrittenSources,
): Partial<Record<CheckedSourceKind, SourceCheck | null>> {
  return Object.fromEntries(
    writtenSources(imported).map(({ kind, file }) => [
      kind,
      file && pending(file),
    ]),
  );
}

/** After an import put its files in place, the checker and interactor it wrote are compiled on a judge, as an upload in the editor is; the editor shows the result. */
@Injectable()
export class ImportSourceChecks {
  private readonly logger = new Logger(ImportSourceChecks.name);

  constructor(
    @InjectQueue(SOURCE_CHECK_QUEUE)
    private readonly queue: Queue<SourceCheckJob>,
  ) {}

  /** The transaction already marked these checks pending (`importedSourceChecks`); a later upload in the editor wins, because the check job runs only while its file is still the problem's and records only over its own pending check. Never throws: the import stands, and the editor shows the check as pending. */
  async checkAfterImport(
    problemId: string,
    imported: WrittenSources,
  ): Promise<void> {
    try {
      for (const { kind, file } of writtenSources(imported))
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
