import { Logger } from '@nestjs/common';
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

  it('never sends a closed judge work, and queues it for the others', async () => {
    const problem = await freshProblem();
    const closing = new RecordingJudge('closed', [problem.code]);
    await dispatch.register(closing);
    closing.isClosed = true;
    const id = await submit(problem._id);
    await enqueue(id);
    expect(sentTo(closing)).toEqual([]);
    expect(dispatch.queuedIds()).toContain(id);
    await dispatch.judgeFree(closing);
    expect(sentTo(closing)).toEqual([]);
  });

  it('gives back a submission claimed for a judge that closed during the claim', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('closing', [problem.code]);
    await dispatch.register(judge);
    const id = await submit(problem._id);
    const pending = dispatch.enqueue(await repository.loadQueued([id]));
    expect(judge.workingOn).toBe(id);
    judge.isClosed = true;
    await pending;
    expect(sentTo(judge)).toEqual([]);
    expect(await statusOf(id)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      requeueCount: 0,
    });
    expect(dispatch.queuedIds()).toContain(id);
    await dispatch.judgeLost(judge);
    expect(dispatch.queuedIds()).toContain(id);
  });

  it('lets the replacing connection grade a submission claimed during the replacement, untouched by the old close', async () => {
    const problem = await freshProblem();
    const first = new RecordingJudge('same', [problem.code]);
    await dispatch.register(first);
    const id = await submit(problem._id);
    const pending = dispatch.enqueue(await repository.loadQueued([id]));
    expect(first.workingOn).toBe(id);
    const second = new RecordingJudge('same', [problem.code]);
    const registering = dispatch.register(second);
    await pending;
    await registering;
    expect(sentTo(first)).toEqual([]);
    expect(sentTo(second)).toEqual([id]);
    await dispatch.judgeLost(first);
    expect(await statusOf(id)).toMatchObject({
      status: 'P',
      judgedOn: 'same',
      requeueCount: 0,
    });
  });

  it('frees the judge when both the claim and its release fail, and serves it once Mongo is back', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('outage', [problem.code]);
    await dispatch.register(judge);
    const lost = await submit(problem._id);
    const outage = new Error('mongo down');
    jest.spyOn(repository, 'claim').mockRejectedValueOnce(outage);
    jest.spyOn(repository, 'release').mockRejectedValueOnce(outage);
    await expect(enqueue(lost)).rejects.toThrow('mongo down');
    expect(judge.workingOn).toBeNull();
    const next = await submit(problem._id);
    await enqueue(next);
    expect(sentTo(judge)).toEqual([next]);
  });

  it('never sends one judge two submissions or one submission twice under concurrent enqueues', async () => {
    const problem = await freshProblem();
    const judge = new RecordingJudge('solo', [problem.code]);
    await dispatch.register(judge);
    const one = await submit(problem._id);
    const two = await submit(problem._id);
    const queuedOne = await repository.loadQueued([one]);
    const queuedTwo = await repository.loadQueued([two]);
    await Promise.all([
      dispatch.enqueue(queuedOne),
      dispatch.enqueue(queuedOne),
      dispatch.enqueue(queuedTwo),
      dispatch.enqueue(queuedTwo),
    ]);
    expect(sentTo(judge)).toEqual([one]);
    expect(dispatch.queuedIds()).toContain(two);
    expect(dispatch.queuedIds()).not.toContain(one);
    await dispatch.judgeFree(judge);
    expect(sentTo(judge)).toEqual([one, two]);
  });

  describe('commands from the api', () => {
    let redis: Redis;
    let publisher: BridgeCommandsService;
    let commands: CommandsService;
    let errors: jest.SpyInstance;
    let warnings: jest.SpyInstance;
    beforeAll(async () => {
      redis = new Redis(TEST_REDIS_URL);
      publisher = new BridgeCommandsService(redis);
      commands = bridge.module.get(CommandsService);
      await commands.stop(); // the bridge's own reader, started at bootstrap, would also read these commands
    });
    beforeEach(() => {
      errors = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      warnings = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });
    afterEach(async () => {
      await commands.stop();
      await redis.del(BRIDGE_COMMANDS_STREAM);
      jest.restoreAllMocks();
    });
    afterAll(() => redis.quit());

    it('does not replay commands published before its start position', async () => {
      const problem = await freshProblem();
      const judge = new RecordingJudge('earlier', [problem.code]);
      await dispatch.register(judge);
      await publisher.publish({
        type: 'disconnect-judge',
        judgeName: 'earlier',
        force: true,
      });
      commands.start(await commands.position());
      await publisher.publish({
        type: 'disable-judge',
        judgeName: 'earlier',
        isDisabled: true,
      });
      await waitUntil(() => judge.isDisabled);
      expect(judge.disconnects).toEqual([]);
    });

    it('applies judge, abort, disable and disconnect commands, skipping a malformed entry with a warning', async () => {
      commands.start(await commands.position());
      const problem = await freshProblem();
      const light = new RecordingJudge('cmd-light', [problem.code], 0);
      const named = new RecordingJudge('cmd-named', [problem.code], 0.5);
      await dispatch.register(light);
      await dispatch.register(named);
      const id = await submit(problem._id);
      await redis.xadd(BRIDGE_COMMANDS_STREAM, '*', 'command', '{broken');
      await publisher.judge([id], 'cmd-named');
      await waitUntil(() => named.received.length === 1, 500);
      expect(sentTo(named)).toEqual([id]);
      expect(sentTo(light)).toEqual([]);
      expect(warnings).toHaveBeenCalledTimes(1);
      expect(errors).not.toHaveBeenCalled();
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

    it('keeps reading after its connection drops, and logs it', async () => {
      commands.start(await commands.position());
      const problem = await freshProblem();
      const judge = new RecordingJudge('dropped', [problem.code]);
      await dispatch.register(judge);
      const id = await submit(problem._id);
      await enqueue(id);
      (commands as unknown as { reader: Redis }).reader.stream.destroy();
      await publisher.publish({ type: 'abort', submissionId: id });
      await waitUntil(() => judge.terminations === 1, 8000);
      expect(errors).toHaveBeenCalled();
    });

    it('backs off on a reply error, recovers, and stops without waiting out the backoff', async () => {
      const problem = await freshProblem();
      const judge = new RecordingJudge('backoff', [problem.code]);
      await dispatch.register(judge);
      await redis.set(BRIDGE_COMMANDS_STREAM, 'not a stream');
      commands.start('0-0');
      await waitUntil(() => errors.mock.calls.length >= 1, 8000);
      await redis.del(BRIDGE_COMMANDS_STREAM);
      await publisher.publish({
        type: 'disable-judge',
        judgeName: 'backoff',
        isDisabled: true,
      });
      await waitUntil(() => judge.isDisabled, 8000);
      await redis.del(BRIDGE_COMMANDS_STREAM);
      await redis.set(BRIDGE_COMMANDS_STREAM, 'not a stream');
      const before = errors.mock.calls.length;
      await waitUntil(() => errors.mock.calls.length > before, 8000);
      const started = Date.now();
      await commands.stop();
      expect(Date.now() - started).toBeLessThan(500);
    });
  });
});
