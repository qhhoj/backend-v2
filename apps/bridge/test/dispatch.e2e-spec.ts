import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { BRIDGE_COMMANDS_STREAM, BridgeCommandsService } from '@libs/judging';
import { CommandsService } from '../src/dispatch/commands.service';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import {
  seedCatalog,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { RecordingJudge } from './recording-judge';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

describe('DispatchService', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let dispatch: DispatchService;
  let repository: SubmissionsRepository;
  let codes = 0;
  /** Each test judges its own problem, so judges left registered by earlier tests never compete. */
  const freshProblem = async () => {
    codes += 1;
    return seedProblem(bridge, catalog, { code: `d${codes}` });
  };
  const submit = async (problemId: string, fields: object = {}) =>
    (await seedSubmission(bridge, catalog, { problem: problemId, ...fields }))
      ._id;
  const enqueue = async (...ids: string[]) =>
    dispatch.enqueue(await repository.loadQueued(ids));
  const statusOf = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;
  const sentTo = (judge: RecordingJudge) =>
    judge.received.map((request) => request.submissionId);

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    dispatch = bridge.module.get(DispatchService);
    repository = bridge.module.get(SubmissionsRepository);
  });
  afterAll(() => bridge.teardown());

  it('sends a submission to the free judge with the lowest load and claims it in Mongo', async () => {
    const problem = await freshProblem();
    const heavy = new RecordingJudge('heavy', [problem.code], 0.9);
    const light = new RecordingJudge('light', [problem.code], 0.1);
    await dispatch.register(heavy);
    await dispatch.register(light);
    const id = await submit(problem._id);
    await enqueue(id);
    expect(sentTo(light)).toEqual([id]);
    expect(light.received[0]).toMatchObject({
      problemCode: problem.code,
      languageKey: 'CPP17',
    });
    expect(sentTo(heavy)).toEqual([]);
    expect(await statusOf(id)).toMatchObject({
      status: 'P',
      judgedOn: 'light',
    });
  });

  it('queues what no judge can take and hands it to the first capable judge that registers', async () => {
    const problem = await freshProblem();
    const id = await submit(problem._id);
    await enqueue(id);
    expect(dispatch.queuedIds()).toContain(id);
    const capable = new RecordingJudge('capable', [problem.code]);
    await dispatch.register(capable);
    expect(sentTo(capable)).toEqual([id]);
    expect(dispatch.queuedIds()).not.toContain(id);
  });

  it('serves a freed judge by priority, then oldest first, and never queues an id twice', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('serial', [problem.code]);
    await dispatch.register(judge);
    const first = await submit(problem._id);
    await enqueue(first);
    const batch = await submit(problem._id, { priority: 3 });
    const normal = await submit(problem._id, { priority: 1 });
    const rejudge = await submit(problem._id, { priority: 2 });
    const entries = await repository.loadQueued([batch, normal, rejudge]);
    await dispatch.enqueue([
      ...entries,
      ...entries,
      { ...entries[0], id: first },
    ]);
    expect(dispatch.queuedIds()).toEqual([normal, rejudge, batch]);
    for (let round = 0; round < 3; round += 1) await dispatch.judgeFree(judge);
    expect(sentTo(judge)).toEqual([first, normal, rejudge, batch]);
  });

  it('drops a queued submission that is no longer QU in Mongo and serves the next', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('skipper', [problem.code]);
    await dispatch.register(judge);
    const running = await submit(problem._id);
    const aborted = await submit(problem._id);
    const next = await submit(problem._id);
    await enqueue(running, aborted, next);
    await bridge.submissions.updateOne(
      { _id: aborted },
      { $set: { status: 'AB', result: 'AB' } },
    );
    await dispatch.judgeFree(judge);
    expect(sentTo(judge)).toEqual([running, next]);
    expect(dispatch.queuedIds()).not.toContain(aborted);
    expect(await statusOf(aborted)).toMatchObject({
      status: 'AB',
      judgedOn: null,
    });
  });

  it('terminates a running submission on abort and forgets a queued one', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('aborter', [problem.code]);
    await dispatch.register(judge);
    const running = await submit(problem._id);
    const queued = await submit(problem._id);
    await enqueue(running, queued);
    dispatch.abort(running);
    dispatch.abort(queued);
    expect(judge.terminations).toBe(1);
    expect(dispatch.queuedIds()).not.toContain(queued);
  });

  it('gives a disabled judge no work until enabled, except work that asks for it by name', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('sleepy', [problem.code]);
    judge.isDisabled = true;
    await dispatch.register(judge);
    const anyJudge = await submit(problem._id);
    await enqueue(anyJudge);
    expect(sentTo(judge)).toEqual([]);
    const requested = await submit(problem._id);
    await dispatch.enqueue(
      (await repository.loadQueued([requested])).map((entry) => ({
        ...entry,
        judgeName: 'sleepy',
      })),
    );
    expect(sentTo(judge)).toEqual([requested]);
    await dispatch.setDisabled('sleepy', false);
    await dispatch.judgeFree(judge);
    expect(sentTo(judge)).toEqual([requested, anyJudge]);
  });

  it("requeues the replaced connection's submission", async () => {
    const problem = await freshProblem();
    const first = new RecordingJudge('twin', [problem.code]);
    await dispatch.register(first);
    const id = await submit(problem._id);
    await enqueue(id);
    const second = new RecordingJudge('twin', [problem.code]);
    await dispatch.register(second);
    expect(first.disconnects).toEqual([true]);
    await dispatch.judgeLost(first);
    expect(sentTo(second)).toEqual([id]);
    expect(await statusOf(id)).toMatchObject({
      status: 'P',
      judgedOn: 'twin',
      requeueCount: 1,
    });
  });

  it('requeues once when a judge is lost and fails the submission the second time', async () => {
    const problem = await freshProblem();
    const first = new RecordingJudge('lost-1', [problem.code]);
    await dispatch.register(first);
    const id = await submit(problem._id);
    await enqueue(id);
    await dispatch.judgeLost(first);
    expect(dispatch.queuedIds()).toContain(id);
    const second = new RecordingJudge('lost-2', [problem.code]);
    await dispatch.register(second);
    await dispatch.judgeLost(second);
    expect(await statusOf(id)).toMatchObject({
      status: 'IE',
      result: 'IE',
      requeueCount: 1,
    });
    expect(
      (await bridge.gradedJobs()).map((job) => job.submissionId),
    ).toContain(id);
  });

  describe('commands from the api', () => {
    const redis = new Redis(TEST_REDIS_URL);
    const publisher = new BridgeCommandsService(redis);
    let commands: CommandsService;
    beforeAll(async () => {
      commands = bridge.module.get(CommandsService);
      commands.start(await commands.position());
    });
    afterAll(async () => {
      await commands.stop();
      await redis.quit();
    });

    it('applies judge, abort, disable and disconnect commands, skipping malformed entries', async () => {
      const problem = await freshProblem();
      const light = new RecordingJudge('cmd-light', [problem.code], 0);
      const named = new RecordingJudge('cmd-named', [problem.code], 0.5);
      await dispatch.register(light);
      await dispatch.register(named);
      const id = await submit(problem._id);
      await redis.xadd(BRIDGE_COMMANDS_STREAM, '*', 'command', '{broken');
      await publisher.judge([id], 'cmd-named');
      await waitUntil(() => named.received.length === 1);
      expect(sentTo(named)).toEqual([id]);
      expect(sentTo(light)).toEqual([]);
      await publisher.publish({ type: 'abort', submissionId: id });
      await publisher.publish({
        type: 'disable-judge',
        judgeName: 'cmd-light',
        isDisabled: true,
      });
      await publisher.publish({
        type: 'disconnect-judge',
        judgeName: 'cmd-light',
        force: false,
      });
      await waitUntil(() => light.disconnects.length === 1);
      expect(named.terminations).toBe(1);
      expect(light.isDisabled).toBe(true);
      expect(light.disconnects).toEqual([false]);
    });
  });
});
