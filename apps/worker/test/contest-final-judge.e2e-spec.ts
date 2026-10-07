import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  finalJudgeJobId,
  rescheduleFinalJudge,
} from '@libs/contests';
import type { ContestFinalJudgeJob, FinalJudgeTarget } from '@libs/contests';
import { uuidStr } from '@libs/database';
import {
  BRIDGE_COMMANDS_STREAM,
  parseBridgeCommand,
  parseSubmissionEvent,
  SUBMISSION_EVENTS_CHANNEL,
} from '@libs/judging';
import { ContestFinalJudgeService } from '../src/jobs/contest-final-judge/contest-final-judge.service';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const hours = (count: number) => new Date(Date.now() + count * 3_600_000);

describe('FSO final judging', () => {
  let worker: WorkerTest;
  let service: ContestFinalJudgeService;
  let redis: Redis;
  const commandedIds = async () =>
    (await redis.xrange(BRIDGE_COMMANDS_STREAM, '-', '+')).flatMap(
      ([, fields]) => {
        const command = parseBridgeCommand(
          fields[fields.indexOf('command') + 1],
        );
        return command?.type === 'judge' ? command.submissionIds : [];
      },
    );
  const statusesOf = async (ids: string[]) =>
    (await worker.submissions.find({ _id: { $in: ids } }).lean()).map(
      (row) => row.status,
    );
  const fsoContest = (extra: object = {}) =>
    seedContest(worker, {
      formatName: 'final_submission',
      formatConfig: { autoJudge: true },
      startTime: hours(-3),
      endTime: hours(-1),
      ...extra,
    });
  const pending = async (contest: { _id: string }, count: number) => {
    const problem = await seedProblem(worker);
    const user = await seedUser(worker);
    const participation = await seedParticipation(
      worker,
      contest._id,
      user._id,
    );
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1)
      ids.push(
        (
          await seedContestSubmission(worker, participation, problem._id, {
            status: 'PD',
            result: null,
            points: null,
            judgedDate: null,
          })
        )._id,
      );
    return { ids, problem, participation, user };
  };

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ContestFinalJudgeService);
    redis = new Redis(TEST_REDIS_URL);
  });
  afterAll(async () => {
    await redis.quit();
    await worker.teardown();
  });
  beforeEach(() => redis.del(BRIDGE_COMMANDS_STREAM));

  it('requeues each pending submission once when the job and the sweep both fire', async () => {
    const contest = await fsoContest();
    const { ids, problem, participation } = await pending(contest, 3);
    const judged = await seedContestSubmission(
      worker,
      participation,
      problem._id,
    );
    await Promise.all([
      service.judgeFinal(contest._id, false),
      service.sweep(),
      service.judgeFinal(contest._id, true),
    ]);
    const rows = await worker.submissions.find({ _id: { $in: ids } }).lean();
    expect(rows.map((row) => [row.status, row.priority])).toEqual([
      ['QU', 3],
      ['QU', 3],
      ['QU', 3],
    ]);
    expect(rows.every((row) => row.rejudgedDate !== null)).toBe(true);
    expect((await commandedIds()).sort()).toEqual([...ids].sort());
    expect(await service.judgeFinal(contest._id, false)).toBe(0);
    expect((await worker.submissions.findById(judged._id).lean())!.status).toBe(
      'D',
    );
  });

  it('announces each requeued submission as queued, like a rejudge', async () => {
    const contest = await fsoContest();
    const { ids, user } = await pending(contest, 2);
    const subscriber = new Redis(TEST_REDIS_URL);
    const events: Array<{ submissionId: string; userId: string }> = [];
    subscriber.on('message', (_channel, message) => {
      const event = parseSubmissionEvent(message);
      if (event?.type === 'queued' && event.status === 'QU') events.push(event);
    });
    await subscriber.subscribe(SUBMISSION_EVENTS_CHANNEL);
    try {
      await service.judgeFinal(contest._id, false);
      await waitUntil(() => events.length === ids.length);
      expect(events.map((event) => event.submissionId).sort()).toEqual(
        [...ids].sort(),
      );
      expect(events.every((event) => event.userId === uuidStr(user._id))).toBe(
        true,
      );
    } finally {
      await subscriber.quit();
    }
  });

  it("waits for the end and honours autoJudge, except on an editor's request", async () => {
    const running = await fsoContest({ endTime: hours(1) });
    const live = await pending(running, 2);
    expect(await service.judgeFinal(running._id, false)).toBe(0);
    expect(await service.judgeFinal(running._id, true)).toBe(0);
    const manualOnly = await fsoContest({ formatConfig: { autoJudge: false } });
    const waiting = await pending(manualOnly, 2);
    await service.sweep();
    expect(await statusesOf([...live.ids, ...waiting.ids])).toEqual([
      'PD',
      'PD',
      'PD',
      'PD',
    ]);
    expect(await service.judgeFinal(manualOnly._id, true)).toBe(2);
    expect(await statusesOf(waiting.ids)).toEqual(['QU', 'QU']);
  });

  it('follows an endTime edit and ignores the stale job', async () => {
    const queue = worker.module.get<Queue<ContestFinalJudgeJob>>(
      getQueueToken(CONTEST_FINAL_JUDGE_QUEUE),
    );
    const firstEnd = new Date(Date.now() + 1500);
    const contest = await fsoContest({
      startTime: hours(-1),
      endTime: firstEnd,
    });
    const { ids } = await pending(contest, 2);
    const target = (endTime: Date): FinalJudgeTarget => ({
      id: contest._id,
      endTime,
      formatName: 'final_submission',
      formatConfig: { autoJudge: true },
    });
    await rescheduleFinalJudge(
      queue,
      null,
      target(firstEnd),
      new Logger('spec'),
    );
    const laterEnd = new Date(Date.now() + 4000);
    await worker.contests.updateOne(
      { _id: contest._id },
      { endTime: laterEnd },
    );
    await rescheduleFinalJudge(
      queue,
      target(firstEnd),
      target(laterEnd),
      new Logger('spec'),
    );
    expect(await queue.getJob(finalJudgeJobId(contest._id, firstEnd))).toBe(
      undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 2000));
    // Past the first end: a stale job that still fired would find the contest running.
    expect(await service.judgeFinal(contest._id, false)).toBe(0);
    expect(await statusesOf(ids)).toEqual(['PD', 'PD']);
    // The command follows the status flip, so wait for the command.
    await waitUntil(
      async () => (await commandedIds()).length === ids.length,
      10_000,
    );
    expect(await statusesOf(ids)).toEqual(['QU', 'QU']);
    expect((await commandedIds()).sort()).toEqual([...ids].sort());
  });
});
