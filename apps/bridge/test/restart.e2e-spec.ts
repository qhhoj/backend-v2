import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { BridgeCommandsService } from '@libs/judging';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
  waitUntil,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { SubmissionsRepository } from '../src/submissions/submissions.repository';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const KEY = 'restart key';

describe('Bridge restart', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  const redis = new Redis(TEST_REDIS_URL);
  const submissionRow = async (id: string) =>
    (await bridge.submissions.findById(id).select('+cases').lean())!;
  const connect = (name: string, problems: string[]) =>
    FakeJudge.online(bridge.judgePort(), { name, key: KEY, problems });

  beforeAll(async () => {
    bridge = await setupBridgeTest({ timings: { resyncMs: 300 } });
    catalog = await seedCatalog(bridge);
  });
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  it('a restart while grading dispatches the submission again without IE or a spent requeue', async () => {
    await seedJudge(bridge, 'restart-1', KEY);
    const problem = await seedProblem(bridge, catalog, { code: 'restart1' });
    const { _id: id } = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    await new BridgeCommandsService(redis).judge([id]);
    const judge = await connect('restart-1', ['restart1']);
    await judge.next('submission-request');
    judge.send({ name: 'submission-acknowledged', 'submission-id': id });
    judge.send({
      name: 'grading-begin',
      'submission-id': id,
      pretested: false,
    });
    await waitUntil(async () => (await submissionRow(id)).status === 'G');
    await bridge.restart();
    await judge.closed;
    expect(await submissionRow(id)).toMatchObject({
      status: 'QU',
      requeueCount: 0,
      judgedOn: null,
      cases: [],
    });
    expect(
      (await bridge.judges.findOne({ name: 'restart-1' }).lean())?.online,
    ).toBe(false);
    const again = await connect('restart-1', ['restart1']);
    expect((await again.next('submission-request'))['submission-id']).toBe(id);
    expect(await submissionRow(id)).toMatchObject({
      status: 'P',
      requeueCount: 0,
    });
    expect(
      (await bridge.gradedJobs()).map((job) => job.submissionId),
    ).not.toContain(id);
    await again.close();
  });

  it('marks judges a crashed bridge left online as offline', async () => {
    await seedJudge(bridge, 'restart-ghost', KEY, {
      online: true,
      ping: 0.1,
      load: 0.5,
    });
    await bridge.restart();
    expect(
      await bridge.judges.findOne({ name: 'restart-ghost' }).lean(),
    ).toMatchObject({
      online: false,
      ping: null,
      load: null,
    });
  });

  it('rebuilds the queue in priority, then age order, interrupted work included', async () => {
    await seedJudge(bridge, 'restart-2', KEY);
    const problem = await seedProblem(bridge, catalog, { code: 'restart2' });
    const seed = async (fields: object) =>
      (
        await seedSubmission(bridge, catalog, {
          problem: problem._id,
          ...fields,
        })
      )._id;
    const interrupted = await seed({ status: 'G', judgedOn: 'gone' });
    const batch = await seed({ priority: 3 });
    const normal = await seed({ priority: 1 });
    const rejudge = await seed({ priority: 2 });
    await bridge.restart();
    const judge = await connect('restart-2', ['restart2']);
    for (const expected of [interrupted, normal, rejudge, batch]) {
      const request = await judge.next('submission-request');
      expect(request['submission-id']).toBe(expected);
      judge.send({
        name: 'submission-acknowledged',
        'submission-id': expected,
      });
      judge.send({
        name: 'compile-error',
        'submission-id': expected,
        log: 'stop',
      });
    }
    await waitUntil(async () => (await submissionRow(batch)).status === 'CE');
    await judge.close();
  });

  it('dispatches a queued submission that no command announced', async () => {
    await seedJudge(bridge, 'restart-3', KEY);
    const problem = await seedProblem(bridge, catalog, { code: 'restart3' });
    const judge = await connect('restart-3', ['restart3']);
    const { _id: id } = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    expect(
      (await judge.next('submission-request', 3000))['submission-id'],
    ).toBe(id);
    await judge.close();
  });
  it('keeps resyncing without double-queueing what is running or already queued', async () => {
    await seedJudge(bridge, 'restart-4', KEY);
    const problem = await seedProblem(bridge, catalog, { code: 'restart4' });
    const judge = await connect('restart-4', ['restart4']);
    const first = (
      await seedSubmission(bridge, catalog, { problem: problem._id })
    )._id;
    const second = (
      await seedSubmission(bridge, catalog, { problem: problem._id })
    )._id;
    const requestedIds = () =>
      judge.received
        .filter((packet) => packet.name === 'submission-request')
        .map((packet) => packet['submission-id']);
    await waitUntil(() => requestedIds().length === 1);
    judge.send({ name: 'submission-acknowledged', 'submission-id': first });
    judge.send({
      name: 'grading-begin',
      'submission-id': first,
      pretested: false,
    });
    // several resync ticks while the first is running and the second waits behind the busy judge
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(requestedIds()).toEqual([first]);
    judge.send({ name: 'grading-end', 'submission-id': first });
    await waitUntil(() => requestedIds().length === 2);
    judge.send({ name: 'submission-acknowledged', 'submission-id': second });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(requestedIds()).toEqual([first, second]);
    expect(await submissionRow(second)).toMatchObject({
      status: 'P',
      requeueCount: 0,
    });
    await judge.close();
  });

  it('survives a failed resync and recovers on the next tick', async () => {
    await seedJudge(bridge, 'restart-5', KEY);
    const problem = await seedProblem(bridge, catalog, { code: 'restart5' });
    const judge = await connect('restart-5', ['restart5']);
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const loadQueued = jest
      .spyOn(bridge.module.get(SubmissionsRepository), 'loadQueued')
      .mockRejectedValue(new Error('mongo down'));
    await waitUntil(() => loadQueued.mock.calls.length >= 2);
    const { _id: id } = await seedSubmission(bridge, catalog, {
      problem: problem._id,
    });
    expect(
      judge.received.some((packet) => packet.name === 'submission-request'),
    ).toBe(false);
    loadQueued.mockRestore();
    expect(
      (await judge.next('submission-request', 3000))['submission-id'],
    ).toBe(id);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('mongo down'));
    logged.mockRestore();
    await judge.close();
  });
});
