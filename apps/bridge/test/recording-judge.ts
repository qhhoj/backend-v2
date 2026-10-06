import type { DispatchTarget } from '../src/dispatch/dispatch';
import type { SubmissionRequest } from '../src/protocol/judge-packets';

/** A judge connection without a socket: records what the dispatcher sends it. */
export class RecordingJudge implements DispatchTarget {
  workingOn: string | null = null;
  isDisabled = false;
  isClosed = false;
  problems: ReadonlySet<string>;
  executors: ReadonlySet<string> = new Set(['CPP17', 'PY3']);
  readonly received: SubmissionRequest[] = [];
  terminations = 0;
  readonly disconnects: boolean[] = [];

  constructor(
    readonly name: string,
    problems: string[],
    public load = 0,
  ) {
    this.problems = new Set(problems);
  }

  submit(request: SubmissionRequest): void {
    this.received.push(request);
  }

  terminate(): void {
    this.terminations += 1;
  }

  disconnect(force: boolean): void {
    this.disconnects.push(force);
  }
}
