import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type {
  CheckedSourceKind,
  DataFileKind,
  ProblemData,
  SourceCheck,
  SourceChecks,
} from '@libs/database';
import { SOURCE_CHECK_JOB_OPTIONS, SOURCE_CHECK_QUEUE } from '@libs/problems';
import type { SourceCheckJob } from '@libs/problems';
import { ProblemsRepository } from '../core/problems.repository';

const isChecked = (kind: DataFileKind): kind is CheckedSourceKind =>
  kind === 'customChecker' || kind === 'customGrader';
/** The uploaded header compiles beside the checker, so changing it re-checks the checker. */
const checkedKindOf = (kind: DataFileKind): DataFileKind =>
  kind === 'customHeader' ? 'customChecker' : kind;

/** Only an interactor compiles on its own; a signature grader needs the contestant's code, so it is not checked. */
const compilesAlone = (kind: CheckedSourceKind, data: ProblemData): boolean =>
  kind === 'customChecker' || data.grader === 'interactive';

/** Queues the compile check of an uploaded checker or interactor and keeps its state on the problem. */
@Injectable()
export class SourceChecksService {
  constructor(
    private readonly repository: ProblemsRepository,
    @InjectQueue(SOURCE_CHECK_QUEUE)
    private readonly queue: Queue<SourceCheckJob>,
  ) {}

  /** After `changed` was uploaded as `data[changed]` (or removed): a fresh `pending` check of it (of the checker, for a header) is queued, or the old state dropped. */
  async afterFileChange(
    problemId: string,
    changed: DataFileKind,
    data: ProblemData,
  ): Promise<void> {
    const kind = checkedKindOf(changed);
    if (!isChecked(kind)) return;
    const file = data[kind];
    if (!file || !compilesAlone(kind, data))
      return this.repository.setSourceCheck(problemId, kind, null);
    const pending: SourceCheck = {
      file,
      status: 'pending',
      log: '',
      checkedAt: null,
    };
    await this.repository.setSourceCheck(problemId, kind, pending);
    await this.queue.add(
      SOURCE_CHECK_QUEUE,
      { problemId, kind, file },
      SOURCE_CHECK_JOB_OPTIONS,
    );
  }

  async of(problemId: string): Promise<SourceChecks> {
    const checks = await this.repository.sourceChecksOf(problemId);
    return {
      customChecker: checks?.customChecker ?? null,
      customGrader: checks?.customGrader ?? null,
    };
  }
}
