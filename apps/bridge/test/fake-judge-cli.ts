/**
 * A judge-v2 stand-in for the local full stack (`npm run stack:up`, `STACK_JUDGE=fake`): real gRPC
 * via FakeJudge. Answers AC unless the source holds FAKE_JUDGE_SOURCE_WA, then WA.
 *
 * Env: JUDGE_BRIDGE_PORT (required), FAKE_JUDGE_NAME, FAKE_JUDGE_KEY, FAKE_JUDGE_SLOTS (default 2),
 * FAKE_JUDGE_CASES (JSON {code: count}; unknown problem = 1), FAKE_JUDGE_SOURCE_WA, FULLSTACK_CONTROL_DIR.
 *
 * Gates: while `$FULLSTACK_CONTROL_DIR/hold-<stage>` exists the judge waits before sending that stage
 * (`ack` = Accepted, `begin` = GradingStarted, `end` = the cases and Final). Release `hold-ack` within
 * the bridge's accept timeout (20 s) or the bridge aborts that run and assigns it again.
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Outcome } from '@libs/judge-proto';
import type { Assign, AssignmentRef } from '@libs/judge-proto';
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
const slots = Number(env('FAKE_JUDGE_SLOTS', '2'));
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
const keyOf = (ref: AssignmentRef) => `${ref.submissionId}.${ref.generation}`;

/** Blocks while `hold-<stage>` exists in the control dir; the tests create and remove these files. */
async function passGate(stage: 'ack' | 'begin' | 'end'): Promise<void> {
  if (!controlDir) return;
  const gate = join(controlDir, `hold-${stage}`);
  if (!(await exists(gate))) return;
  console.log(`holding at ${stage}`);
  while (await exists(gate)) await sleep(GATE_POLL_MS);
}

/** Runs the bridge aborted; each answers Final ABORTED, accepted or not, as judge-v2 does (preflight C2: the bridge frees the slot on it). */
const aborted = new Set<string>();

async function grade(judge: FakeJudge, assign: Assign): Promise<void> {
  const ref = assign.ref!;
  const source = Buffer.from(assign.source).toString('utf8');
  const verdict = verdictFor(source, wrongAnswerMarker);
  await passGate('ack');
  if (aborted.has(keyOf(ref)))
    return void judge.final(ref, Outcome.OUTCOME_ABORTED);
  judge.accept(ref);
  await passGate('begin');
  if (aborted.has(keyOf(ref)))
    return void judge.final(ref, Outcome.OUTCOME_ABORTED);
  const count = caseCounts[assign.problemCode] ?? 1;
  judge.started(ref, count);
  await passGate('end');
  if (aborted.has(keyOf(ref)))
    return void judge.final(ref, Outcome.OUTCOME_ABORTED);
  judge.cases(ref, casesFor(count, verdict));
  judge.final(ref, Outcome.OUTCOME_GRADED);
}

/** The bridge may still be starting: retry the first connection. */
async function connectWithRetry(): Promise<FakeJudge> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await FakeJudge.online(port, { name, key, slots });
    } catch (error) {
      if (attempt >= CONNECT_TRIES) throw error;
      await sleep(CONNECT_RETRY_MS);
    }
  }
}

async function serve(judge: FakeJudge): Promise<void> {
  while (!judge.isClosed) {
    for (const { abort } of judge.takeAll('abort'))
      if (abort.ref) aborted.add(keyOf(abort.ref));
    const assign = await judge.nextAssign(1000).catch(() => null);
    if (assign) void grade(judge, assign);
  }
}

async function main(): Promise<void> {
  for (;;) {
    const judge = await connectWithRetry();
    console.log(`judge online as ${name} on ${port}`);
    await serve(judge);
    console.log('the bridge ended the session, reconnecting');
  }
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
