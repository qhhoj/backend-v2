import type { PolygonSyncStep } from '@libs/database';
import type { ImportProgress } from '@libs/problems';

/** Reports a step to the job's progress (best effort: a failed report never fails the import). */
export type ReportProgress = (progress: ImportProgress) => Promise<void>;

/** Follows one running import: a progress report moves the step, and the steps the status page does not show (`saving`, `finishing`) are entered directly, so a failure knows where it stopped. */
export class ImportTracker {
  private current: PolygonSyncStep = 'checking';

  constructor(
    private readonly report: ReportProgress = () => Promise.resolve(),
  ) {}

  get step(): PolygonSyncStep {
    return this.current;
  }

  enter(step: PolygonSyncStep): void {
    this.current = step;
  }

  progress(progress: ImportProgress): Promise<void> {
    this.current = progress.step;
    return this.report(progress);
  }
}
