import { runDeadlineMs, startedRunDeadlineMs } from '../bridge-timings';
import type { BridgeTimings } from '../bridge-timings';

/** setTimeout fires at once for a longer delay (Node clamps it to 1 ms). */
const MAX_TIMER_MS = 2 ** 31 - 1;

interface RunDeadline {
  timer: NodeJS.Timeout | null;
  timeLimitSeconds: number;
  /** From the run's Started; null before it. */
  caseCount: number | null;
}

/** Per-run deadline timers by `windingKey`, with the budget each is computed from (time limit, then Started's case count). A run in grace keeps its budget with the timer paused, so a resume restarts the same allowance. */
export class RunDeadlines {
  private readonly runs = new Map<string, RunDeadline>();

  constructor(
    private readonly timings: Pick<
      BridgeTimings,
      'runMarginMs' | 'runCaseBudget'
    >,
  ) {}

  /** At Assign: `runDeadlineMs` from the time limit. */
  arm(key: string, timeLimitSeconds: number, onExpiry: () => void): void {
    this.clear(key);
    const run = { timer: null, timeLimitSeconds, caseCount: null };
    this.runs.set(key, run);
    this.start(run, onExpiry);
  }

  /** At the run's stored Started: restarts from now with a per-case allowance. False when the run has no budget. */
  started(key: string, caseCount: number, onExpiry: () => void): boolean {
    const run = this.runs.get(key);
    if (!run) return false;
    run.caseCount = caseCount;
    this.start(run, onExpiry);
    return true;
  }

  /** At a resume: restarts the kept budget from now. False when there is none (the bridge restarted meanwhile). */
  resume(key: string, onExpiry: () => void): boolean {
    const run = this.runs.get(key);
    if (!run) return false;
    this.start(run, onExpiry);
    return true;
  }

  /** The judge was lost: the timer stops, the budget is kept for a resume. */
  pause(key: string): void {
    const run = this.runs.get(key);
    if (run) clearTimeout(run.timer ?? undefined);
    if (run) run.timer = null;
  }

  clear(key: string): void {
    clearTimeout(this.runs.get(key)?.timer ?? undefined);
    this.runs.delete(key);
  }

  clearAll(): void {
    for (const key of [...this.runs.keys()]) this.clear(key);
  }

  private start(run: RunDeadline, onExpiry: () => void): void {
    clearTimeout(run.timer ?? undefined);
    run.timer = null;
    const delay =
      run.caseCount === null
        ? runDeadlineMs(this.timings, run.timeLimitSeconds)
        : startedRunDeadlineMs(
            this.timings,
            run.timeLimitSeconds,
            run.caseCount,
          );
    // no deadline for non-finite inputs; a delay past the timer range waits the longest it can
    if (delay === null) return;
    run.timer = setTimeout(onExpiry, Math.min(delay, MAX_TIMER_MS));
    run.timer.unref();
  }
}
