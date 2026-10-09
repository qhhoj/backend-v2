/**
 * A judge-server stand-in for the local full stack (`npm run stack:up`): real TCP and DMOJ framing via
 * FakeJudge. Answers AC unless the source holds FAKE_JUDGE_SOURCE_WA, then WA.
 *
 * Env: JUDGE_BRIDGE_PORT (required), FAKE_JUDGE_NAME, FAKE_JUDGE_KEY, FAKE_JUDGE_PROBLEMS (csv),
 * FAKE_JUDGE_CASES (JSON {code: count}; unknown problem = 1), FAKE_JUDGE_SOURCE_WA, FULLSTACK_CONTROL_DIR.
 *
 * Gates: while `$FULLSTACK_CONTROL_DIR/hold-<stage>` exists the judge waits before sending that stage
 * (`ack`, `begin`, `end`). Release `hold-ack` within 20 s or the bridge closes the connection; the CLI
 * then reconnects.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeJudge } from './fake-judge';
import { casesFor, verdictFor } from './fake-judge-verdict';

const env = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const port = Number(env('JUDGE_BRIDGE_PORT'));
const name = env('FAKE_JUDGE_NAME', 'e2e-judge');
const key = env('FAKE_JUDGE_KEY', 'e2e-judge-key');
const problems = env('FAKE_JUDGE_PROBLEMS', 'e2e_sum,e2e_max').split(',');
const caseCounts = JSON.parse(
  env('FAKE_JUDGE_CASES', '{"e2e_sum":1,"e2e_max":2}'),
) as Record<string, number>;
const wrongAnswerMarker = env('FAKE_JUDGE_SOURCE_WA', '# fake-judge:WA');
const controlDir = process.env.FULLSTACK_CONTROL_DIR;
const GATE_POLL_MS = 50;
const CONNECT_TRIES = 10;
const CONNECT_RETRY_MS = 500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Blocks while `hold-<stage>` exists in the control dir; the tests create and remove these files. */
async function passGate(stage: 'ack' | 'begin' | 'end'): Promise<void> {
  if (!controlDir) return;
  const gate = join(controlDir, `hold-${stage}`);
  while (await exists(gate)) await sleep(GATE_POLL_MS);
}

async function grade(
  judge: FakeJudge,
  request: Record<string, unknown>,
): Promise<void> {
  const id = request['submission-id'] as string;
  const verdict = verdictFor(
    typeof request.source === 'string' ? request.source : '',
    wrongAnswerMarker,
  );
  await passGate('ack');
  judge.send({ name: 'submission-acknowledged', 'submission-id': id });
  await passGate('begin');
  judge.send({ name: 'grading-begin', 'submission-id': id, pretested: false });
  await passGate('end');
  const count = caseCounts[String(request['problem-id'])] ?? 1;
  judge.send({
    name: 'test-case-status',
    'submission-id': id,
    cases: casesFor(count, verdict),
  });
  judge.send({ name: 'grading-end', 'submission-id': id });
}

/** The bridge may still be starting: retry the first connection. */
async function connectWithRetry(): Promise<FakeJudge> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await FakeJudge.online(port, { name, key, problems });
    } catch (error) {
      if (attempt >= CONNECT_TRIES) throw error;
      await sleep(CONNECT_RETRY_MS);
    }
  }
}

async function serve(judge: FakeJudge): Promise<void> {
  while (!judge.isClosed) {
    const request = await judge
      .next('submission-request', 60_000)
      .catch(() => null);
    if (request) void grade(judge, request);
  }
}

async function main(): Promise<void> {
  for (;;) {
    const judge = await connectWithRetry();
    console.log(`judge online as ${name} on ${port}`);
    await serve(judge);
    console.log('bridge closed the connection, reconnecting');
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
