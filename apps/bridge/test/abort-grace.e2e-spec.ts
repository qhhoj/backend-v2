import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { BridgeCommandsService } from '@libs/judging';
import { Outcome, Resume_Action } from '@libs/judge-proto';
import type { AssignmentRef } from '@libs/judge-proto';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { DispatcherService } from '../src/dispatch/dispatcher.service';
import type { DispatchTarget } from '../src/dispatch/slots';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const KEY = 'abort grace key';
const GRACE_MS = 3000;

/** An abort the bridge handles after the judge's stream died but before it handled the loss (`judgeLost`): the Abort goes to the dead stream, and must still stick through the grace. */
describe('Abort racing a disconnect', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let codes = 0;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const row = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;

  beforeAll(async () => {
    bridge = await setupBridgeTest({ timings: { resumeGraceMs: GRACE_MS } });
    catalog = await seedCatalog(bridge);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  /** A judge `name` grading a fresh submission: Accepted and GradingStarted acked (seq 2). */
  const grading = async (name: string) => {
    await seedJudge(bridge, name, KEY);
    const problem = await seedProblem(bridge, catalog, {
      code: `abortgrace${(codes += 1)}`,
    });
    const { _id: id } = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    await commands.judge([id]);
    const judge = await FakeJudge.online(bridge.judgePort(), {
      name,
      key: KEY,
    });
    const ref = (await judge.nextAssign()).ref!;
    judge.accept(ref);
    judge.started(ref, 1);
    await judge.ackOf(ref, 2);
    return { id, judge, ref };
  };

  /** The judge dies; the bridge's handling of the loss is held until the api's abort was handled, so the abort meets the dead, still registered session. */
  const abortBeforeLossIsHandled = async (
    name: string,
    judge: FakeJudge,
    id: string,
  ) => {
    const dispatcher = bridge.module.get(DispatcherService);
    const judgeLost = dispatcher.judgeLost.bind(dispatcher);
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let lossSeen = false;
    jest
      .spyOn(dispatcher, 'judgeLost')
      .mockImplementation(async (target: DispatchTarget) => {
        lossSeen = true;
        await held;
        return judgeLost(target);
      });
    const abort = jest.spyOn(dispatcher, 'abort');
    await judge.close();
    await waitUntil(() => lossSeen);
    await commands.publish({ type: 'abort', submissionId: id });
    await waitUntil(() => abort.mock.calls.some(([seen]) => seen === id));
    release();
    await waitUntil(
      async () => !(await bridge.judges.findOne({ name }).lean())?.online,
    );
  };

  const reconnect = (name: string, ref: AssignmentRef) => {
    const again = FakeJudge.open(bridge.judgePort(), {
      name,
      key: KEY,
      inFlight: [{ ref, lastSeqSent: 2 }],
    });
    again.hello();
    return again;
  };

  it('a resume sends Abort right after the Welcome, and the run ends AB', async () => {
    const { id, judge, ref } = await grading('abort-grace-resume');
    await abortBeforeLossIsHandled('abort-grace-resume', judge, id);
    const again = reconnect('abort-grace-resume', ref);
    const welcome = (await again.nextMessage()).body;
    expect(welcome?.$case === 'welcome' && welcome.welcome.resume).toEqual([
      { ref, action: Resume_Action.ACTION_CONTINUE, fromSeq: 3 },
    ]);
    expect((await again.nextMessage()).body).toEqual({
      $case: 'abort',
      abort: { ref },
    });
    again.final(ref, Outcome.OUTCOME_ABORTED);
    await waitUntil(async () => (await row(id)).status === 'AB');
    expect(await row(id)).toMatchObject({ result: 'AB', requeueCount: 0 });
    await again.close();
  });

  it('a grace that expires ends the run AB, never requeued or sent to another judge', async () => {
    const { id, judge } = await grading('abort-grace-expiry');
    await seedJudge(bridge, 'abort-grace-other', KEY);
    const other = await FakeJudge.online(bridge.judgePort(), {
      name: 'abort-grace-other',
      key: KEY,
    });
    await abortBeforeLossIsHandled('abort-grace-expiry', judge, id);
    await waitUntil(
      async () => (await row(id)).status === 'AB',
      GRACE_MS + 5000,
    );
    expect(await row(id)).toMatchObject({ result: 'AB', requeueCount: 0 });
    expect(other.seen('assign')).toEqual([]);
    await other.close();
  });
});
