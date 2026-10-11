import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import type { SubmissionCase } from '@libs/database';
import { BRIDGE_COMMANDS_STREAM, BridgeCommandsService } from '@libs/judging';
import { recordSubmissionEvents } from '@libs/judging/testing';
import type { AssignmentRef } from '@libs/judge-proto';
import { CommandsService } from '../src/dispatch/commands.service';
import { DispatcherService } from '../src/dispatch/dispatcher.service';
import { RunsService } from '../src/submissions/runs.service';
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

describe('DispatcherService (with Mongo)', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  let dispatch: DispatcherService;
  let repository: SubmissionsRepository;
  let names = 0;
  /** A unique judge name, so judges left registered by earlier tests never compete. */
  const judgeNamed = (prefix: string, slots = 1) =>
    new RecordingJudge(`${prefix}-${(names += 1)}`, slots);
  /** Judges stay registered after a test, so `afterEach` closes them: a later test's work goes only to its own judges. */
  const brought: RecordingJudge[] = [];
  const online = async (judge: RecordingJudge) => {
    brought.push(judge);
    await dispatch.resume(judge, []);
    await dispatch.register(judge);
    return judge;
  };
  const submit = async (fields: object = {}, language?: string) => {
    const problem = await seedProblem(bridge, catalog, {
      code: `d${(names += 1)}`,
    });
    return (
      await seedSubmission(bridge, catalog, {
        problem: problem._id,
        ...(language && { language }),
        ...fields,
      })
    )._id;
  };
  const enqueue = async (...ids: string[]) =>
    dispatch.enqueue(await repository.loadQueued(ids));
  const statusOf = async (id: string) =>
    (await bridge.submissions.findById(id).lean())!;
  const sentTo = (judge: RecordingJudge) =>
    judge.received.map((request) => request.ref.submissionId);
  const refOf = (judge: RecordingJudge, id: string): AssignmentRef =>
    judge.received.find((request) => request.ref.submissionId === id)!.ref;
  /** The run ended (as a stored Final would end it). */
  const finish = (judge: RecordingJudge, id: string) =>
    dispatch.runEnded(judge, refOf(judge, id), { retried: false });

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    dispatch = bridge.module.get(DispatcherService);
    repository = bridge.module.get(SubmissionsRepository);
  });
  afterEach(() => {
    for (const judge of brought.splice(0)) judge.isClosed = true;
    for (const id of dispatch.queuedIds()) dispatch.abort(id);
  });
  afterAll(() => bridge.teardown());

  it('drops a queued submission that is no longer QU in Mongo and serves the next', async () => {
    const judge = await online(judgeNamed('skipper'));
    judge.executors = new Set(['TEXT']);
    const text = await bridge.languages.create({
      key: 'TEXT',
      name: 'Text',
      commonName: 'Text',
      ace: 'text',
      pygments: 'text',
      extension: 'txt',
    });
    const running = await submit({}, text._id);
    const aborted = await submit({}, text._id);
    const next = await submit({}, text._id);
    await enqueue(running, aborted, next);
    await bridge.submissions.updateOne(
      { _id: aborted },
      { $set: { status: 'AB', result: 'AB' } },
    );
    await finish(judge, running);
    expect(sentTo(judge)).toEqual([running, next]);
    expect(dispatch.queuedIds()).not.toContain(aborted);
    expect(await statusOf(aborted)).toMatchObject({
      status: 'AB',
      judgedOn: null,
      judgeGeneration: 0,
    });
    judge.isClosed = true;
  });

  it('never sends a closing judge work, and gives back a claim made for a judge that closed during it', async () => {
    const closing = await online(judgeNamed('closed'));
    closing.isClosed = true;
    const queued = await submit();
    await enqueue(queued);
    expect(sentTo(closing)).toEqual([]);
    expect(dispatch.queuedIds()).toContain(queued);
    dispatch.abort(queued);
    const judge = await online(judgeNamed('closing'));
    const id = await submit();
    const pending = dispatch.enqueue(await repository.loadQueued([id]));
    expect(judge.inFlight.get(id)).toBe(0);
    judge.isClosed = true;
    await pending;
    expect(sentTo(judge)).toEqual([]);
    expect(await statusOf(id)).toMatchObject({
      status: 'QU',
      judgedOn: null,
      requeueCount: 0,
      judgeGeneration: 1,
    });
    expect(dispatch.queuedIds()).toContain(id);
    dispatch.abort(id);
  });

  it('frees the slot when the claim fails (Mongo down; the resync recovers the row), and serves the next', async () => {
    const judge = await online(judgeNamed('outage'));
    const lost = await submit();
    const outage = new Error('mongo down');
    jest.spyOn(repository, 'claimRun').mockRejectedValueOnce(outage);
    await enqueue(lost);
    expect(judge.inFlight.size).toBe(0);
    const next = await submit();
    await enqueue(next);
    expect(sentTo(judge)).toEqual([next]);
    judge.isClosed = true;
  });

  it('never fills more slots than it has or sends one submission twice under concurrent enqueues', async () => {
    const judge = await online(judgeNamed('pair', 2));
    const [one, two, three] = [await submit(), await submit(), await submit()];
    const [queuedOne, queuedTwo, queuedThree] = await Promise.all(
      [one, two, three].map((id) => repository.loadQueued([id])),
    );
    await Promise.all([
      dispatch.enqueue(queuedOne),
      dispatch.enqueue(queuedOne),
      dispatch.enqueue(queuedTwo),
      dispatch.enqueue(queuedThree),
      dispatch.enqueue(queuedTwo),
    ]);
    expect(sentTo(judge).sort()).toEqual([one, two].sort());
    expect(dispatch.queuedIds()).toContain(three);
    await finish(judge, one);
    expect(sentTo(judge)).toHaveLength(3);
    judge.isClosed = true;
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

    it('applies judge, abort, disable and disconnect commands, skipping a malformed entry with a warning', async () => {
      commands.start(await commands.position());
      const light = await online(judgeNamed('cmd-light', 4));
      const named = await online(judgeNamed('cmd-named', 1));
      const id = await submit();
      await redis.xadd(BRIDGE_COMMANDS_STREAM, '*', 'command', '{broken');
      await publisher.judge([id], named.name);
      await waitUntil(() => named.received.length === 1, 500);
      expect(sentTo(light)).toEqual([]);
      expect(warnings).toHaveBeenCalledTimes(1);
      expect(errors).not.toHaveBeenCalled();
      await publisher.publish({ type: 'abort', submissionId: id });
      await publisher.publish({
        type: 'disable-judge',
        judgeName: light.name,
        isDisabled: true,
      });
      await publisher.publish({
        type: 'disconnect-judge',
        judgeName: light.name,
        force: false,
      });
      await waitUntil(() => light.disconnects.length === 1);
      expect(named.aborts).toEqual([{ submissionId: id, generation: 1 }]);
      expect(light.isDisabled).toBe(true);
      expect(light.disconnects).toEqual([false]);
      for (const judge of [light, named]) judge.isClosed = true;
    });

    it('keeps reading after its connection drops, and logs it', async () => {
      commands.start(await commands.position());
      const judge = await online(judgeNamed('dropped'));
      const id = await submit();
      await enqueue(id);
      (commands as unknown as { reader: Redis }).reader.stream.destroy();
      await publisher.publish({ type: 'abort', submissionId: id });
      await waitUntil(() => judge.aborts.length === 1, 8000);
      expect(errors).toHaveBeenCalled();
      judge.isClosed = true;
    });

    it('backs off on a reply error, recovers, and stops without waiting out the backoff', async () => {
      const judge = await online(judgeNamed('backoff'));
      await redis.set(BRIDGE_COMMANDS_STREAM, 'not a stream');
      commands.start('0-0');
      await waitUntil(() => errors.mock.calls.length >= 1, 8000);
      await redis.del(BRIDGE_COMMANDS_STREAM);
      await publisher.publish({
        type: 'disable-judge',
        judgeName: judge.name,
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
      judge.isClosed = true;
    });
  });

  describe('submission events', () => {
    const reportedCase: SubmissionCase = {
      position: 1,
      status: 'AC',
      time: 0.1,
      memory: 1000,
      points: 1,
      total: 1,
      batch: null,
      feedback: '',
      extendedFeedback: '',
      output: '',
    };

    it('publishes processing, grading-begin, test-case and done for a run, and queued when the grace of its lost judge expires', async () => {
      const runs = bridge.module.get(RunsService);
      const recorder = await recordSubmissionEvents(TEST_REDIS_URL);
      try {
        const judge = await online(judgeNamed('evented'));
        const graded = await submit();
        await enqueue(graded);
        const key = (seq: number) => ({
          ref: refOf(judge, graded),
          judgeName: judge.name,
          seq,
        });
        await runs.accepted(key(1));
        await runs.started(key(2), false);
        await runs.cases(key(3), [reportedCase]);
        await runs.final(key(4), {
          kind: 'graded',
          log: '',
          dataVersionUsed: 0,
        });
        await finish(judge, graded);
        const lost = await submit();
        await enqueue(lost);
        await runs.started(
          { ref: refOf(judge, lost), judgeName: judge.name, seq: 1 },
          false,
        );
        await dispatch.judgeLost(judge);
        await recorder.waitFor((events) =>
          events.some(
            (event) => event.submissionId === lost && event.type === 'queued',
          ),
        );
        const typesOf = (id: string) =>
          recorder.events
            .filter((event) => event.submissionId === id)
            .map((event) => event.type);
        expect(typesOf(graded)).toEqual([
          'processing',
          'grading-begin',
          'test-case',
          'done',
        ]);
        expect(typesOf(lost)).toEqual([
          'processing',
          'grading-begin',
          'queued',
        ]);
      } finally {
        await recorder.stop();
      }
    });
  });
});
