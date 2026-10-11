import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { BridgeCommandsService } from '@libs/judging';
import type { GenerationPlan } from '@libs/judging';
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
    const id = await this.repository.enqueue(plan, bundle);
    try {
      await this.commands.generate(id);
      await this.waitForDone(id, plan);
      await this.repository.saveResult(id, destination);
    } finally {
      await this.repository.remove(id);
    }
  }

  private async waitForDone(id: string, plan: GenerationPlan): Promise<void> {
    const startedAt = Date.now();
    const capMs = (plan.deadlineS + WAIT_GRACE_S) * MS_PER_SECOND;
    for (;;) {
      const state = await this.repository.stateOf(id);
      if (!state) throw new PolygonImportError('test generation was cancelled');
      if (state.status === 'done') return;
      if (state.status === 'failed')
        throw new PolygonImportError(
          describeGenerationFailure(state.failure, plan),
        );
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > capMs)
        throw new PolygonImportError(
          generationTimeoutText(
            Math.ceil((plan.deadlineS + WAIT_GRACE_S) / SECONDS_PER_MINUTE),
          ),
        );
      if (state.status === 'queued' && (await this.stranded(elapsedMs)))
        throw new PolygonImportError(NO_JUDGE_TEXT);
      await sleep(POLL_MS);
    }
  }

  private async stranded(queuedMs: number): Promise<boolean> {
    return (
      queuedMs > NO_JUDGE_AFTER_MS && !(await this.repository.hasCapableJudge())
    );
  }
}
