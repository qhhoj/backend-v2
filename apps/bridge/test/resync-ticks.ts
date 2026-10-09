import { BridgeService } from '../src/bridge.service';
import { waitUntil } from './fixtures';

/** BridgeService's private resync tick, seen from the test. */
interface Resyncing {
  resyncing: boolean;
  resync: (this: Resyncing) => Promise<void>;
}
const prototype = BridgeService.prototype as unknown as Resyncing;
const resync = prototype.resync;
/** Completed resync ticks, across restarts (a tick skipped because the previous one still ran is not counted). */
let ticks = 0;

/** Counts completed resync ticks from now on; call in `beforeAll`, and `jest.restoreAllMocks()` in `afterAll`. */
export function countResyncTicks(): void {
  jest.spyOn(prototype, 'resync').mockImplementation(async function (
    this: Resyncing,
  ) {
    const skipped = this.resyncing;
    await resync.call(this);
    if (!skipped) ticks += 1;
  });
}

/** Resolves once `count` more resync ticks completed: the tests wait on ticks, never on the clock. */
export async function resyncTicks(count: number): Promise<void> {
  const target = ticks + count;
  await waitUntil(() => ticks >= target, 10_000);
}
