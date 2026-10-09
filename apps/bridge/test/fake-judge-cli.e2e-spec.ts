import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { BridgeCommandsService } from '@libs/judging';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const ROOT = resolve(__dirname, '..', '..', '..');

/** The `STACK_JUDGE=fake` judge as `npm run stack:up` starts it, against a test bridge. */
describe('fake-judge-cli', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let cli: ChildProcess;
  let output = '';
  const control = mkdtempSync(join(tmpdir(), 'qhhoj-fake-judge-control-'));
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const row = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    await seedJudge(bridge, 'cli-judge', 'cli-key');
    cli = spawn(
      'node',
      [
        '-r',
        'ts-node/register/transpile-only',
        '-r',
        'tsconfig-paths/register',
        'apps/bridge/test/fake-judge-cli.ts',
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          JUDGE_BRIDGE_PORT: String(bridge.judgePort()),
          FAKE_JUDGE_NAME: 'cli-judge',
          FAKE_JUDGE_KEY: 'cli-key',
          FAKE_JUDGE_CASES: '{"cli_sum":2}',
          FULLSTACK_CONTROL_DIR: control,
        },
      },
    );
    cli.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    cli.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    await waitUntil(() => output.includes('judge online'), 30_000);
  }, 60_000);
  afterAll(async () => {
    cli?.kill();
    await redis.quit();
    await bridge.teardown();
    rmSync(control, { recursive: true, force: true });
  });

  it('grades AC, WA for a source with the marker, and holds a stage while its gate file exists', async () => {
    const problem = await seedProblem(bridge, catalog, { code: 'cli_sum' });
    const accepted = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    const wrong = await seedSubmission(bridge, catalog, {
      problem: problem._id,
      source: 'x\n# fake-judge:WA\n',
    });
    await commands.judge([accepted._id, wrong._id]);
    await waitUntil(async () => (await row(wrong._id)).status === 'D', 10_000);
    expect(await row(accepted._id)).toMatchObject({
      status: 'D',
      result: 'AC',
      caseTotal: 2,
    });
    expect(await row(wrong._id)).toMatchObject({ result: 'WA' });
    writeFileSync(join(control, 'hold-begin'), '');
    const held = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    await commands.judge([held._id]);
    await waitUntil(async () => (await row(held._id)).judgeSeq === 1, 10_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await row(held._id)).toMatchObject({ status: 'P' });
    rmSync(join(control, 'hold-begin'));
    await waitUntil(async () => (await row(held._id)).status === 'D', 10_000);
  }, 60_000);
});
