import { newId } from '@libs/database';
import type { AssignmentRef, GenerateTests } from '@libs/judge-proto';
import type { DispatchTarget } from '../src/dispatch/slots';
import type { AssignRequest } from '../src/submissions/assign-request';

/** A judge session without a stream: records what the dispatcher sends it. */
export class RecordingJudge implements DispatchTarget {
  readonly id = newId();
  readonly inFlight = new Map<string, number>();
  readonly winding = new Set<string>();
  readonly settling = new Set<string>();
  readonly generations = new Set<string>();
  features: ReadonlySet<string> = new Set();
  build = 'test';
  isDisabled = false;
  isDraining = false;
  isClosed = false;
  authKeyHash = '';
  executors: ReadonlySet<string> = new Set(['CPP17', 'PY3']);
  readonly received: AssignRequest[] = [];
  readonly aborts: AssignmentRef[] = [];
  readonly generated: GenerateTests[] = [];
  readonly cancelledGenerations: string[] = [];
  readonly disconnects: boolean[] = [];
  wasReplaced = false;

  constructor(
    readonly name: string,
    public slots = 1,
  ) {}

  assign(request: AssignRequest): void {
    this.received.push(request);
  }

  abort(ref: AssignmentRef): void {
    this.aborts.push(ref);
  }

  generate(message: GenerateTests): void {
    this.generated.push(message);
  }

  cancelGeneration(generationId: string): void {
    this.cancelledGenerations.push(generationId);
  }

  disconnect({ isForced }: { isForced: boolean }): void {
    this.disconnects.push(isForced);
  }

  replaced(): void {
    this.wasReplaced = true;
  }

  /** The submission ids of its runs (claims in flight included). */
  holding(): string[] {
    return [...this.inFlight.keys()];
  }
}
