import { status } from '@grpc/grpc-js';
import type { StatusObject } from '@grpc/grpc-js';
import { BridgeMessage, JudgeMessage } from '@libs/judge-proto';
import type { AssignmentRef } from '@libs/judge-proto';
import { expand } from '@libs/judge-proto/conformance/expand';
import { kindOf } from '@libs/judge-proto/conformance/scenario';
import type {
  JsonObject,
  Scenario,
  Step,
} from '@libs/judge-proto/conformance/scenario';
import { mismatch } from '@libs/judge-proto/conformance/matcher';
import type { Json } from '@libs/judge-proto/conformance/matcher';
import { waitUntil } from '@libs/common/testing';
import { withinTimeout } from '@libs/judging';
import { FakeJudge } from '../fake-judge';
import type { BridgeTimings } from '../../src/bridge-timings';
import { messageRateClock, systemNow } from '../../src/link/message-rate';
import type { BridgeTest } from '../setup';
import type { ManualAcceptClock } from './manual-accept-clock';
import type { ScenarioWorld } from './world';

/** Every wait is bounded by this, so a failing scenario fails fast with the step it stopped at. */
export const STEP_TIMEOUT_MS = 5000;
/** How long `end_state` may take to settle after the last step (offline marks and grace outcomes land asynchronously). */
const END_STATE_MS = 2000;
const POLL_MS = 50;

/** Bridge timings a scenario does not name: `FAST_TIMINGS` (setup.ts) with the handshake and idle clocks long enough that a loaded host never trips them in a scenario that does not test them. The accept clock is the runner's (`ManualAcceptClock`): `acceptMs` is not waited for. */
const UNNAMED_TIMINGS: Partial<BridgeTimings> = {
  handshakeMs: 2000,
  idleMs: 5000,
  acceptMs: 5000,
};

/** The timings the bridge runs a scenario with. */
export const timingsOf = (scenario: Scenario): Partial<BridgeTimings> => ({
  ...UNNAMED_TIMINGS,
  ...scenario.timings,
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const statusName = (code: number): string => status[code];

/** `promise`, or a rejection naming `what` after `ms`. */
const within = <T>(promise: Promise<T>, ms: number, what: string): Promise<T> =>
  withinTimeout(promise, ms).catch((error: Error) => {
    throw new Error(`${what}: ${error.message}`);
  });

const shown = (message: BridgeMessage): string =>
  JSON.stringify(BridgeMessage.toJSON(message));

/** Plays the judge role of a scenario against the real bridge: `open`, `judge`, `drop` and `fetch` steps act, `bridge`, `quiet` and `closed` steps are checked in arrival order (pings skipped), `api`, `wait` and `restart_bridge` act on the world. */
export class ScenarioRunner {
  /** Scenario judge name -> its current session. */
  private readonly judges = new Map<string, FakeJudge>();
  /** The scenario's clock for the flood cap: it moves only by `wait` and `quiet` steps, so a `repeat` burst is one instant on any host. */
  private scriptedNow = Date.now();

  constructor(
    private readonly bridge: BridgeTest,
    private readonly world: ScenarioWorld,
    private readonly scenario: Scenario,
    private readonly acceptClock: ManualAcceptClock,
  ) {}

  async run(): Promise<void> {
    const scriptedNow = () => this.scriptedNow;
    messageRateClock.now = scriptedNow;
    try {
      await this.steps();
    } finally {
      // a run jest abandoned at its timeout must not take the clock from the next scenario's run
      if (messageRateClock.now === scriptedNow)
        messageRateClock.now = systemNow;
    }
    const differs = await this.settledEndState();
    if (differs) throw new Error(`${this.scenario.name} end_state: ${differs}`);
  }

  private async steps(): Promise<void> {
    for (const [index, step] of this.scenario.steps.entries())
      await this.step(step).catch((error: Error) => {
        throw new Error(
          `${this.scenario.name} step ${index + 1} (${kindOf(step)}): ${error.message}`,
        );
      });
  }

  /** Ends every session still open; bounded, so a stuck stream cannot hang the suite. */
  async close(): Promise<void> {
    for (const judge of this.judges.values())
      await within(judge.close(), STEP_TIMEOUT_MS, 'closed').catch(
        () => undefined,
      );
    this.judges.clear();
  }

  /** Polls `end_state` until it matches or `END_STATE_MS` passes; the last difference otherwise. */
  private async settledEndState(): Promise<string | null> {
    const deadline = Date.now() + END_STATE_MS;
    for (;;) {
      const differs = await this.world.endStateMismatch(this.scenario);
      if (!differs || Date.now() > deadline) return differs;
      await sleep(POLL_MS);
    }
  }

  private expanded(value: Json): Json {
    return expand(value, this.world.bindings);
  }

  private judge(name: string): FakeJudge {
    const judge = this.judges.get(name);
    if (!judge) throw new Error(`${name} has no session`);
    return judge;
  }

  private async step(step: Step): Promise<void> {
    if ('open' in step) return this.open(step.open);
    if ('judge' in step) return this.send(step.judge);
    if ('bridge' in step) return this.expect(step.bridge);
    if ('quiet' in step) return this.quiet(step.quiet);
    if ('closed' in step) return this.closed(step.closed);
    if ('drop' in step) return this.drop(step.drop.judge);
    if ('fetch' in step) return this.fetch(step.fetch);
    if ('api' in step) return this.world.api(step.api);
    if ('wait' in step) {
      this.scriptedNow += step.wait.ms;
      return void (await sleep(step.wait.ms));
    }
    await this.bridge.restart(timingsOf(this.scenario));
  }

  /** The judge row a scenario name authenticates as. */
  private identityOf(name: string): string {
    return (
      this.scenario.setup.judges.find((one) => one.name === name)?.as ?? name
    );
  }

  /** The judge a scenario name stands for: `as` connects as another judge, `answers_pings: false` ignores pings; `key` replaces its key (a wrong-key open). */
  private connect(name: string, key?: string): FakeJudge {
    const setup = this.scenario.setup.judges.find((one) => one.name === name);
    const identity = this.identityOf(name);
    return FakeJudge.open(this.bridge.judgePort(), {
      name: identity,
      key: key ?? `${identity}-key`,
      answerPings: setup?.answers_pings !== false,
    });
  }

  private async open({
    judge,
    wrong_key,
    expect = 'OK',
  }: {
    judge: string;
    wrong_key?: boolean;
    expect?: string;
  }): Promise<void> {
    // a reconnect while the old stream is still open: the old one is ours to end
    await this.judges.get(judge)?.close();
    const fake = this.connect(judge, wrong_key ? 'not-the-key' : undefined);
    if (expect === 'OK') return void this.judges.set(judge, fake);
    let ended: StatusObject;
    try {
      ended = await within(fake.closed, STEP_TIMEOUT_MS, 'no refusal');
    } finally {
      await fake.close();
    }
    if (statusName(ended.code) !== expect)
      throw new Error(
        `refused with ${statusName(ended.code)}, expected ${expect}`,
      );
  }

  private send({
    from,
    message,
    repeat = 1,
  }: {
    from: string;
    message: JsonObject;
    repeat?: number;
  }): void {
    const { body } = JudgeMessage.fromJSON(this.expanded(message));
    if (!body) throw new Error('a judge step names no message');
    for (let count = 0; count < repeat; count += 1) this.judge(from).send(body);
  }

  /** The next non-ping message to `to` must match; a Welcome binds `session:<to>`. */
  private async expect({
    to,
    message,
  }: {
    to: string;
    message: JsonObject;
  }): Promise<void> {
    this.timeOutAcceptOf(message);
    const seen = await this.nextMessage(this.judge(to));
    if (seen.body?.$case === 'welcome') {
      this.world.bindings.set(`session:${to}`, seen.body.welcome.sessionId);
      this.judge(to).sessionId = seen.body.welcome.sessionId;
    }
    const differs = mismatch(
      this.expanded(message),
      BridgeMessage.toJSON(seen),
    );
    if (differs) throw new Error(`${differs} in ${shown(seen)}`);
  }

  /** An expected Abort of a run whose accept window is still armed is that window's timeout: the bridge armed it when it sent the Assign, and the runner fires it now, so the transcript, not host timing, decides when an Assign times out. */
  private timeOutAcceptOf(message: JsonObject): void {
    if (!('abort' in message)) return;
    const { body } = BridgeMessage.fromJSON(this.expanded(message));
    if (body?.$case === 'abort' && body.abort.ref)
      this.acceptClock.fire(body.abort.ref);
  }

  /** The next non-ping message. grpc-js may emit a stream's status before the messages that preceded it, so a closed stream is given `POLL_MS` to deliver them. */
  private async nextMessage(fake: FakeJudge): Promise<BridgeMessage> {
    try {
      return await fake.nextMessage(STEP_TIMEOUT_MS);
    } catch (error) {
      if (!fake.isClosed) throw error;
      await sleep(POLL_MS);
      return fake.nextMessage(0);
    }
  }

  private async quiet({ to, ms }: { to: string; ms: number }): Promise<void> {
    this.scriptedNow += ms;
    await sleep(ms);
    const [unexpected] = this.judge(to).pending();
    if (unexpected)
      throw new Error(`expected silence, got ${shown(unexpected)}`);
  }

  private async closed({
    judge,
    status: expected,
  }: {
    judge: string;
    status: string;
  }): Promise<void> {
    const fake = this.judge(judge);
    const ended: StatusObject = await within(
      fake.closed,
      STEP_TIMEOUT_MS,
      'the session did not end',
    );
    if (statusName(ended.code) !== expected)
      throw new Error(
        `ended with ${statusName(ended.code)} (${ended.details}), expected ${expected}`,
      );
    // messages sent before the status may be delivered just after it
    await sleep(POLL_MS);
    const [unread] = fake.pending();
    if (unread) throw new Error(`unread before the end: ${shown(unread)}`);
    await fake.close();
    this.judges.delete(judge);
  }

  /** The judge process dies, and the step ends once the bridge has noticed (it marks the row offline right after holding the runs in grace), so a following `api` step meets a judge that is away. */
  private async drop(judge: string): Promise<void> {
    await within(this.judge(judge).close(), STEP_TIMEOUT_MS, 'dropped');
    this.judges.delete(judge);
    const name = this.identityOf(judge);
    // another open session of the same judge keeps its row online
    const sharing = [...this.judges.keys()].some(
      (other) => this.identityOf(other) === name,
    );
    if (sharing) return;
    await waitUntil(
      async () => !(await this.bridge.judges.findOne({ name }).lean())?.online,
      STEP_TIMEOUT_MS,
    );
  }

  private async fetch({
    judge,
    ref,
    expect,
    bytes = 0,
  }: {
    judge: string;
    ref: JsonObject;
    expect: string;
    bytes?: number;
  }): Promise<void> {
    const reference = this.expanded(ref) as unknown as AssignmentRef;
    const result = await within(
      this.judge(judge).fetchSource(reference),
      STEP_TIMEOUT_MS,
      'no FetchSource answer',
    );
    const code = statusName(result.code);
    if (code !== expect || (expect === 'OK' && result.bytes !== bytes))
      throw new Error(
        `fetch answered ${code} with ${result.bytes} bytes, expected ${expect} with ${bytes}`,
      );
  }
}
