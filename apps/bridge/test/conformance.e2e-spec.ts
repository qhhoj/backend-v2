import { readdirSync, rmdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import {
  loadScenarios,
  SCENARIOS_DIR,
} from '@libs/judge-proto/conformance/scenario';
import type { Scenario } from '@libs/judge-proto/conformance/scenario';
import { BridgeCommandsService } from '@libs/judging';
import { ScenarioRunner, timingsOf } from './conformance/runner';
import { ScenarioWorld, writtenSourceDirs } from './conformance/world';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const scenarios = loadScenarios();
const forBridge = scenarios.filter((scenario) =>
  scenario.applies_to.includes('bridge'),
);

/** judge-v2's conformance scenarios (vendored in libs/judge-proto) played by a scripted judge against the real bridge, Mongo and Redis: one bridge for the file; before each scenario the old bridge stops (its timers die), Mongo is emptied and a bridge with the scenario's timings starts. */
describe('protocol conformance (judge-v2 proto/conformance)', () => {
  let bridge: BridgeTest;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  beforeAll(async () => {
    bridge = await setupBridgeTest();
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

  it('loads every vendored scenario and skips only the judge-only ones', () => {
    const files = readdirSync(SCENARIOS_DIR).filter((file) =>
      file.endsWith('.yaml'),
    );
    expect(scenarios.map((scenario) => `${scenario.name}.yaml`)).toEqual(
      files.sort(),
    );
    const skipped = scenarios.filter(
      (scenario) => !forBridge.includes(scenario),
    );
    expect(skipped.map((scenario) => scenario.applies_to)).toEqual(
      skipped.map(() => ['judge']),
    );
    expect(forBridge.length).toBeGreaterThan(0);
  });

  it.each(
    forBridge.map((scenario): [string, Scenario] => [scenario.name, scenario]),
  )(
    '%s',
    async (_name, scenario) => {
      await bridge.restart();
      await bridge.reset();
      await bridge.restart(timingsOf(scenario));
      const world = new ScenarioWorld(bridge, commands);
      const runner = new ScenarioRunner(bridge, world, scenario);
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
