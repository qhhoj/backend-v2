import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import type { TestGenerationFailure } from '@libs/database';
import { BridgeCommandsService, featureOf } from '@libs/judging';
import type { GenerationPlan } from '@libs/judging';
import type { PolygonImportErrorCode } from '@libs/problems';
import { PolygonImportError } from './polygon-import.error';
import { TestGenerationRepository } from './test-generation.repository';
import {
  describeGenerationFailure,
  generationTimeoutText,
} from './test-generation-failure';

const POLL_MS = 1000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
/** A row nobody takes for this long, with no capable judge online, will not run. */
const NO_JUDGE_AFTER_MS = 2 * SECONDS_PER_MINUTE * MS_PER_SECOND;
/** The worker waits the plan's deadline plus the bridge's own grace. */
const WAIT_GRACE_S = 120;

export const NO_JUDGE_TEXT =
  'no judge can generate tests (needs judge-v2 with test generation); build a full package on Polygon';

/** How a generation ended: done (result uploaded), failed on the judge, removed, past its deadline, or never taken because no capable judge is online. */
export type GenerationEnd =
  | { kind: 'done' }
  | { kind: 'failed'; failure: TestGenerationFailure }
  | { kind: 'cancelled' }
  | { kind: 'timeout' }
  | { kind: 'no-judge' };

/** Asks the judges to generate the tests of a plan and waits for the result zip. */
@Injectable()
export class TestGenerationService {
  constructor(
    private readonly repository: TestGenerationRepository,
    private readonly commands: BridgeCommandsService,
  ) {}

  /**
   * Queues the plan with its bundle, polls the row until a judge finished it, and writes the result zip to
   * `destination`. The `generate` command wakes the bridge; its resync picks up a lost command. Row and files are always
   * removed. Every failure is a `PolygonImportError` the requester can read.
   */
  async generate(
    plan: GenerationPlan,
    bundle: Readable,
    destination: string,
  ): Promise<void> {
    const end = await this.run(plan, bundle, (id) =>
      this.repository.saveResult(id, destination),
    );
    if (end.kind === 'done') return;
    throw new PolygonImportError(endText(end, plan), END_CODES[end.kind]);
  }

  /**
   * Queues the plan with its bundle and polls the row until it ends; `onDone` reads the result before the row and its
   * files are removed (always, whatever the end).
   */
  async run(
    plan: GenerationPlan,
    bundle: Readable,
    onDone: (id: string) => Promise<void> = () => Promise.resolve(),
  ): Promise<GenerationEnd> {
    const id = await this.repository.enqueue(plan, bundle);
    try {
      await this.commands.generate(id);
      const end = await this.waitForEnd(id, plan);
      if (end.kind === 'done') await onDone(id);
      return end;
    } finally {
      await this.repository.remove(id);
    }
  }

  private async waitForEnd(
    id: string,
    plan: GenerationPlan,
  ): Promise<GenerationEnd> {
    const startedAt = Date.now();
    const capMs = (plan.deadlineS + WAIT_GRACE_S) * MS_PER_SECOND;
    for (;;) {
      const state = await this.repository.stateOf(id);
      if (!state) return { kind: 'cancelled' };
      if (state.status === 'done') return { kind: 'done' };
      if (state.status === 'failed')
        return { kind: 'failed', failure: state.failure! };
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > capMs) return { kind: 'timeout' };
      if (state.status === 'queued' && (await this.stranded(plan, elapsedMs)))
        return { kind: 'no-judge' };
      await sleep(POLL_MS);
    }
  }

  private async stranded(
    plan: GenerationPlan,
    queuedMs: number,
  ): Promise<boolean> {
    return (
      queuedMs > NO_JUDGE_AFTER_MS &&
      !(await this.repository.hasCapableJudge(featureOf(plan)))
    );
  }
}

/** The error code of a generation that did not finish. */
const END_CODES: Record<
  Exclude<GenerationEnd, { kind: 'done' }>['kind'],
  PolygonImportErrorCode
> = {
  cancelled: 'generation_failed',
  failed: 'generation_failed',
  timeout: 'generation_timeout',
  'no-judge': 'generation_no_judge',
};

/** The requester's text for a generation that did not finish. */
function endText(
  end: Exclude<GenerationEnd, { kind: 'done' }>,
  plan: GenerationPlan,
): string {
  switch (end.kind) {
    case 'cancelled':
      return 'test generation was cancelled';
    case 'failed':
      return describeGenerationFailure(end.failure, plan);
    case 'timeout':
      return generationTimeoutText(
        Math.ceil((plan.deadlineS + WAIT_GRACE_S) / SECONDS_PER_MINUTE),
      );
    case 'no-judge':
      return NO_JUDGE_TEXT;
  }
}
