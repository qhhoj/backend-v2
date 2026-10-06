import { BRIDGE_TIMINGS } from '../src/bridge-timings';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
} from './fixtures';
import { FAST_TIMINGS, setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

describe('BridgeModule harness', () => {
  let bridge: BridgeTest;
  beforeAll(async () => {
    bridge = await setupBridgeTest({ timings: { resyncMs: 50 } });
  });
  afterAll(() => bridge.teardown());

  it('resolves the bridge timings with the test overrides applied over the fast defaults', () =>
    expect(bridge.module.get(BRIDGE_TIMINGS)).toEqual({
      ...FAST_TIMINGS,
      resyncMs: 50,
    }));

  it('seeds a valid catalog, problem, submission with source and judge, and keeps them across a restart', async () => {
    const catalog = await seedCatalog(bridge);
    const problem = await seedProblem(bridge, catalog, { code: 'aplusb' });
    const submission = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      source: 'print(1)',
    });
    await seedJudge(bridge, 'judge1', 'secret');

    await bridge.restart();

    expect(await bridge.problems.countDocuments({ code: 'aplusb' })).toBe(1);
    expect(await bridge.judges.countDocuments({ name: 'judge1' })).toBe(1);
    expect((await bridge.sources.findById(submission._id))?.source).toBe(
      'print(1)',
    );
    expect(bridge.module.get(BRIDGE_TIMINGS)).toMatchObject({ resyncMs: 50 });
  });
});
