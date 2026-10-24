import { readdirSync, rmdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { loadScenarios } from '@libs/judge-proto/conformance/scenario';
import type { Scenario } from '@libs/judge-proto/conformance/scenario';
import { BridgeCommandsService } from '@libs/judging';
import { ScenarioRunner, timingsOf } from './conformance/runner';
import { ScenarioClocks } from './conformance/scenario-clocks';
import { ScenarioWorld, writtenSourceDirs } from './conformance/world';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const scenarios = loadScenarios();
const forBridge = scenarios.filter((scenario) =>
  scenario.applies_to.includes('bridge'),
);

/** judge-v2's conformance scenarios (vendored in libs/judge-proto) played by a scripted judge against the real bridge, Mongo and Redis: one Mongo and Redis for the file; before each scenario the old bridge stops (its timers die), Mongo and Redis are emptied and one bridge with the scenario's timings starts. The accept, grace and handshake clocks are the runner's (`ScenarioClocks`). */
describe('protocol conformance (judge-v2 proto/conformance)', () => {
  let bridge: BridgeTest;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const clocks = new ScenarioClocks();
  beforeAll(async () => {
    bridge = await setupBridgeTest({
      acceptClock: clocks.accept,
      graceClock: clocks.grace,
      handshakeClock: clocks.handshake,
    });
  });
  afterAll(async () => {
    for (const directory of writtenSourceDirs) {
      rmSync(directory, { recursive: true, force: true });
      // the problem directory too, unless another suite's files are in it
      if (!readdirSync(dirname(directory)).length)
        rmdirSync(dirname(directory));
    }
    await redis.quit();
    await bridge.teardown();
  });

  it.each(
    forBridge.map((scenario): [string, Scenario] => [scenario.name, scenario]),
  )(
    '%s',
    async (_name, scenario) => {
      await bridge.stop();
      await bridge.reset();
      await bridge.start(timingsOf(scenario));
      const world = new ScenarioWorld(bridge, commands, redis);
      const runner = new ScenarioRunner(bridge, world, scenario, clocks);
      try {
        await world.seed(scenario);
        await runner.run();
      } finally {
        await runner.close();
      }
    },
    30_000,
  );
});
