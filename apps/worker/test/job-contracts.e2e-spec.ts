import { existsSync } from 'node:fs';
import { Queue, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import type { UUID } from 'mongodb';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { userDataPath } from '@libs/community';
import { contestDataPath, contestExportPath } from '@libs/contests';
import { newId, toUuid } from '@libs/database';
import { judgingJobs } from '@libs/judging';
import mainJobs from './job-contracts/main-jobs.json';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

/** Jobs written by the release before this one (captured from its producers) and still in Redis at the restart: the new consumers run them. */
describe('jobs queued by the previous release', () => {
  const { ids, jobs } = mainJobs;
  const queued = (queue: string) => jobs.filter((job) => job.queue === queue);
  const otherSubmission = newId();
  let worker: WorkerTest;

  const addAsCaptured = async (captured: (typeof jobs)[number]) => {
    const queue = new Queue(captured.queue, {
      connection: { url: TEST_REDIS_URL },
    });
    await queue.add(captured.name, captured.data, captured.opts);
    await queue.close();
  };

  /** Graded and rescore jobs wait before boot, with no submissions indexes yet. */
  const seedBeforeBoot = async (mongoUri: string) => {
    const client = await MongoClient.connect(mongoUri);
    const database = client.db();
    const problems = database.collection<
      { _id: UUID } & Record<string, unknown>
    >('problems');
    for (const [code, problemId] of Object.entries({
      graded: ids.problem,
      other: ids.otherProblem,
    }))
      await problems.insertOne({
        _id: toUuid(problemId),
        code,
        points: 1000,
        partial: true,
        isPublic: true,
        isOrganizationPrivate: false,
        userCount: 0,
        acRate: 0,
      });
    const submission = (problemId: string, casePoints: number) => ({
      user: toUuid(ids.user),
      problem: toUuid(problemId),
      status: 'D',
      result: casePoints === 1 ? 'AC' : 'WA',
      points: 0,
      casePoints,
      caseTotal: 1,
    });
    await database
      .collection<{ _id: UUID } & Record<string, unknown>>('submissions')
      .insertMany([
        {
          _id: toUuid(ids.submission),
          ...submission(ids.problem, 1),
          effectsDueAt: new Date(),
        },
        { _id: toUuid(otherSubmission), ...submission(ids.otherProblem, 0.5) },
      ]);
    await client.close();
    for (const job of [
      ...queued(judgingJobs.graded.queue),
      ...queued(judgingJobs.problemRescore.queue),
    ])
      await addAsCaptured(job);
  };

  beforeAll(async () => {
    worker = await setupWorkerTest({ seedBeforeBoot });
  });
  afterAll(() => worker.teardown());

  /** Completed jobs are removed at once (`JOB_RETENTION`), so a settled queue counts nothing; a retry would sit in `delayed` past waitUntil's 5 s. */
  const jobCount = async (queueName: string) => {
    const queue = new Queue(queueName, { connection: { url: TEST_REDIS_URL } });
    const counts = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'failed',
    );
    await queue.close();
    return Object.values(counts).reduce((sum, count) => sum + count, 0);
  };

  it('applies the graded jobs of the api and the bridge, and rescores both problems', async () => {
    await waitUntil(async () => {
      const [graded, rescored, other] = await Promise.all([
        worker.problems.findById(ids.problem, { userCount: 1 }).lean(),
        worker.submissions
          .findById(ids.submission, { points: 1, effectsDueAt: 1 })
          .lean(),
        worker.submissions.findById(otherSubmission, { points: 1 }).lean(),
      ]);
      return (
        graded?.userCount === 1 &&
        rescored?.points === 1000 &&
        rescored.effectsDueAt === null &&
        other?.points === 500 &&
        (await jobCount(judgingJobs.graded.queue)) === 0 &&
        (await jobCount(judgingJobs.problemRescore.queue)) === 0
      );
    });
  });

  it('runs the similarity job of the api', async () => {
    await worker.similarityRuns.create({
      _id: ids.run,
      scope: 'problem',
      scopeKey: `problem:${ids.problem}`,
      problem: ids.problem,
      requestedBy: ids.user,
      status: 'queued',
      limits: { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 },
    });
    for (const job of queued(judgingJobs.similarity.queue))
      await addAsCaptured(job);
    await waitUntil(
      async () =>
        (await worker.similarityRuns.findById(ids.run, { status: 1 }).lean())
          ?.status === 'done',
    );
  });
});

/** The contest and community jobs the previous release wrote (captured from its api routes and producers), its schedulers and its global limits: the new worker keeps the schedulers and limits, and completes every job. */
describe('contest and community jobs queued by the previous release', () => {
  const { ids, jobs, flags, schedulers, queues } = mainJobs;
  const end = new Date(mainJobs.end);
  const judgingQueues: string[] = [
    judgingJobs.graded.queue,
    judgingJobs.problemRescore.queue,
    judgingJobs.similarity.queue,
  ];
  const captured = jobs.filter(({ queue }) => !judgingQueues.includes(queue));
  const connection = { url: TEST_REDIS_URL };
  let worker: WorkerTest;

  beforeAll(async () => {
    // A seed step keeps what the boot left in Redis (no flush after boot).
    worker = await setupWorkerTest({ seedBeforeBoot: () => Promise.resolve() });
  });
  afterAll(() => worker.teardown());

  /** One read per queue of the fixture, by queue name. */
  const eachQueue = async <T>(read: (queue: Queue) => Promise<T>) => {
    const byQueue: Record<string, T> = {};
    for (const name of Object.keys(queues)) {
      const queue = new Queue(name, { connection });
      byQueue[name] = await read(queue);
      await queue.close();
    }
    return byQueue;
  };

  it('keeps the schedulers, with the nightly ones in the site time zone, and the global limits', async () => {
    const booted = await eachQueue((queue) => queue.getJobSchedulers());
    expect(
      Object.entries(booted).flatMap(([queue, list]) =>
        list.map(({ key, name, every, pattern, tz, template }) => ({
          queue,
          key,
          name,
          ...(every && { every: Number(every) }),
          ...(pattern && { pattern, tz }),
          template,
        })),
      ),
    ).toEqual(
      expect.arrayContaining(
        schedulers.map((scheduler) =>
          'pattern' in scheduler
            ? { ...scheduler, tz: 'Asia/Ho_Chi_Minh' }
            : scheduler,
        ),
      ),
    );
    expect(Object.values(booted).flat()).toHaveLength(schedulers.length);
    expect(
      await eachQueue(async (queue) => ({
        globalConcurrency: await queue.getGlobalConcurrency(),
      })),
    ).toEqual(queues);
  });

  const seedDocuments = async () => {
    const ended = (extra: Record<string, unknown> = {}) => ({
      name: 'Ended',
      startTime: new Date(end.getTime() - 7_200_000),
      endTime: end,
      ...extra,
    });
    await worker.users.create([
      { _id: ids.editor, username: 'editor', password: '!', isActive: true },
      { _id: ids.contestUser, username: 'user', password: '!', isActive: true },
    ]);
    await worker.organizations.create({
      _id: ids.organization,
      name: 'Organization',
      slug: 'organization',
      shortName: 'organization',
    });
    await worker.contests.create([
      { _id: ids.contest, key: 'ended', ...ended() },
      {
        _id: ids.fsoContest,
        key: 'fso',
        ...ended({
          formatName: 'final_submission',
          formatConfig: { autoJudge: true },
        }),
      },
      { _id: ids.ratedContest, key: 'rated', ...ended({ isRated: true }) },
      { _id: ids.rerateContest, key: 'rerated', ...ended({ isRated: true }) },
      { _id: ids.replayContest, key: 'replay', ...ended() },
      { _id: ids.delayedReplayContest, key: 'replay_later', ...ended() },
      {
        _id: ids.publishContest,
        key: 'publish',
        ...ended({ publishAfterEnd: true, publishAfterEndBy: ids.editor }),
      },
    ]);
    await worker.announcements.create({
      _id: ids.announcement,
      contest: ids.contest,
      title: 'Announcement',
      description: '',
      descriptionHtml: '',
    });
  };

  /** Adds each job with its captured name, data and options; returns the ids BullMQ gave them. */
  const addAsCaptured = async () => {
    const added: string[] = [];
    for (const job of captured) {
      const queue = new Queue(job.queue, { connection });
      const { id } = await queue.add(job.name, job.data, job.opts);
      // The debounced re-rate waits a minute.
      if (job.opts.delay === 60_000) await (await queue.getJob(id!))?.promote();
      added.push(`${job.queue}:${id}`);
      await queue.close();
    }
    return added;
  };

  it('completes every job, and clears the pending flags', async () => {
    await seedDocuments();
    const redis = new Redis(TEST_REDIS_URL);
    for (const flag of flags) await redis.set(flag, '1');
    const completed = new Set<string>();
    const failed: string[] = [];
    const listeners = [...new Set(captured.map(({ queue }) => queue))].map(
      (name) => {
        const events = new QueueEvents(name, { connection });
        events.on('completed', ({ jobId }) =>
          completed.add(`${name}:${jobId}`),
        );
        events.on('failed', ({ jobId, failedReason }) =>
          failed.push(`${name}:${jobId}: ${failedReason}`),
        );
        return events;
      },
    );
    await Promise.all(listeners.map((events) => events.waitUntilReady()));
    try {
      const added = await addAsCaptured();
      expect(added).toHaveLength(captured.length);
      await waitUntil(
        () => failed.length > 0 || added.every((id) => completed.has(id)),
        30_000,
      );
      expect(failed).toEqual([]);
      expect(await redis.exists(...flags)).toBe(0);
      expect(
        [
          contestDataPath(worker.contestDataRoot, ids.contest),
          contestExportPath(worker.contestDataRoot, ids.contest),
          userDataPath(worker.userDataRoot, ids.contestUser),
        ].filter((path) => !existsSync(path)),
      ).toEqual([]);
      expect(
        (await worker.contests.findById(ids.publishContest).lean())
          ?.autoPublishOutcome,
      ).not.toBeNull();
    } finally {
      await Promise.all(listeners.map((events) => events.close()));
      await redis.quit();
    }
  });
});
