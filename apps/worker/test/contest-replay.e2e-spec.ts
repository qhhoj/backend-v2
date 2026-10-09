import { newId, uuidStr } from '@libs/database';
import type { Contest, ContestParticipation, Problem } from '@libs/database';
import { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  CONTEST_REPLAY_QUEUE,
  REPLAY_FORMAT_VERSION,
  REPLAY_SETTLE_MS,
} from '@libs/contests';
import { ContestReplayProcessor } from '../src/jobs/contest-replay/contest-replay.processor';
import { ContestReplayRepository } from '../src/jobs/contest-replay/contest-replay.repository';
import { ContestReplayService } from '../src/jobs/contest-replay/contest-replay.service';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import {
  seedContest,
  seedContestSubmission,
  seedParticipation,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

/** When (minutes after `from`, default the contest start) and how a submission lands. */
interface SubmitFields {
  after: number;
  from?: Date;
  result: 'AC' | 'WA';
  points: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Ended an hour ago: past the settle time, as every real replay build is. */
const ENDED = () => ({
  startTime: new Date(Date.now() - 6 * HOUR),
  endTime: new Date(Date.now() - HOUR),
});

describe('contest replay build', () => {
  let worker: WorkerTest;
  let service: ContestReplayService;
  let repository: ContestReplayRepository;
  let effects: SubmissionEffectsService;
  let processor: ContestReplayProcessor;
  let sum: Problem;
  let max: Problem;
  const entry = (problem: Problem, order: number) => ({
    problem: problem._id,
    points: 100,
    partial: true,
    isPretested: false,
    order,
    outputPrefixOverride: null,
    maxSubmissions: null,
  });
  const contestOf = (extra: Partial<Contest> = {}) =>
    seedContest(worker, {
      problems: [entry(sum, 0), entry(max, 1)],
      ...ENDED(),
      ...extra,
    });
  const join = async (
    contest: Contest,
    extra: Partial<ContestParticipation> = {},
  ) =>
    seedParticipation(worker, contest._id, (await seedUser(worker))._id, extra);
  const submit = async (
    contest: Contest,
    participation: ContestParticipation,
    problem: Problem,
    { after, from = contest.startTime, ...fields }: SubmitFields,
  ) => {
    await seedContestSubmission(worker, participation, problem._id, {
      fields: { ...fields, date: new Date(from.getTime() + after * MINUTE) },
      points: fields.points,
    });
    await effects.recomputeParticipation(participation._id);
  };
  const headOf = (contest: Contest) =>
    worker.replayHeads.findById(contest._id).lean();
  const streamOf = async (contest: Contest, stream: 'real' | 'ghost') => {
    const head = (await headOf(contest))!;
    const chunks = await worker.replayChunks
      .find({ contest: contest._id, buildId: head.buildId, stream })
      .sort({ chunk: 1 })
      .lean();
    return chunks.flatMap((chunk) => chunk.events) as Array<
      [number, number, number, unknown, number, number, number]
    >;
  };
  const eventsOf = (contest: Contest) => streamOf(contest, 'real');

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ContestReplayService);
    repository = worker.module.get(ContestReplayRepository);
    effects = worker.module.get(SubmissionEffectsService);
    processor = worker.module.get(ContestReplayProcessor);
    sum = await seedProblem(worker, { code: 'rsum' });
    max = await seedProblem(worker, { code: 'rmax' });
  });
  afterAll(() => worker.teardown());

  /** The replay's final frame is the live board: each participant's last event carries its stored totals, and its last event per problem the stored cell. */
  const expectFinalFrameStored = async (contest: Contest) => {
    const head = (await headOf(contest))!;
    const events = await eventsOf(contest);
    const problemIds = head.problems.map((problem) =>
      uuidStr(problem.problemId),
    );
    for (const [index, participant] of head.participants.entries()) {
      const stored = (await worker.participations
        .findById(participant.participationId)
        .lean())!;
      const own = events.filter((event) => event[1] === index);
      expect(own.at(-1)!.slice(4)).toEqual([
        stored.score,
        stored.cumtime,
        stored.tiebreaker,
      ]);
      for (const [problemIndex, problemId] of problemIds.entries()) {
        const last = own.filter((event) => event[2] === problemIndex).at(-1);
        if (last) expect(last[3]).toEqual(stored.formatData[problemId]);
      }
    }
    return events;
  };

  it.each(['default', 'ioi', 'icpc', 'vnoj', 'ultimate'] as const)(
    "%s: each participant's last event carries the totals and cells stored on the live board",
    async (formatName) => {
      const contest = await contestOf({ formatName });
      const ann = await join(contest);
      const bob = await join(contest);
      await submit(contest, ann, sum, { after: 5, result: 'WA', points: 0 });
      await submit(contest, ann, sum, { after: 12, result: 'AC', points: 100 });
      await submit(contest, ann, max, { after: 30, result: 'WA', points: 40 });
      await submit(contest, bob, max, { after: 8, result: 'AC', points: 100 });
      await service.build(contest._id);
      expect(await expectFinalFrameStored(contest)).toHaveLength(4);
      const head = (await headOf(contest))!;
      expect(head.formatVersion).toBe(REPLAY_FORMAT_VERSION);
      expect(
        head.problems.map((problem) => uuidStr(problem.problemId)),
      ).toEqual([sum._id, max._id]);
    },
  );

  it("ioi16: each participant's last event carries the batch-scored totals and cells stored on the live board", async () => {
    const batched = await seedProblem(worker, {
      code: 'rbatch',
      data: {
        cases: [
          { type: 'S', points: 30 },
          { type: 'C', points: 0 },
          { type: 'E' },
          { type: 'C', points: 20 },
        ],
      } as never,
    });
    const contest = await seedContest(worker, {
      formatName: 'ioi16',
      problems: [entry(batched, 0)],
      ...ENDED(),
    });
    const ann = await join(contest);
    const bob = await join(contest);
    const cases = (batchPoints: number, otherPoints: number) =>
      [
        { position: 1, status: 'AC', points: batchPoints, total: 30, batch: 1 },
        {
          position: 2,
          status: 'AC',
          points: otherPoints,
          total: 20,
          batch: null,
        },
      ] as never;
    const graded = async (
      participation: ContestParticipation,
      after: number,
      caseRows: never,
    ) => {
      await seedContestSubmission(worker, participation, batched._id, {
        fields: {
          date: new Date(contest.startTime.getTime() + after * MINUTE),
          cases: caseRows,
        },
      });
      await effects.recomputeParticipation(participation._id);
    };
    await graded(ann, 5, cases(0, 20));
    await graded(ann, 9, cases(30, 0));
    await graded(bob, 7, cases(30, 20));
    await service.build(contest._id);
    await expectFinalFrameStored(contest);
    const scores = (
      await worker.participations
        .find({ contest: contest._id })
        .sort({ _id: 1 })
        .lean()
    ).map((row) => row.score);
    // Batch 1 (30 of 50 data points) and the plain case (20) scaled to 100.
    expect(scores).toEqual([100, 100]);
  });

  it('puts a verdict that lands after the build into the replay: the late grading queues a rebuild', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    const bob = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    await service.build(contest._id);
    const first = uuidStr((await headOf(contest))!.buildId);
    expect(await eventsOf(contest)).toHaveLength(1);
    // Submitted during the contest, judged after the build (a judge backlog).
    const late = await seedContestSubmission(worker, bob, max._id, {
      fields: { date: new Date(contest.startTime.getTime() + 50 * MINUTE) },
      points: 0,
    });
    await effects.applyContest(late._id);
    await waitUntil(
      async () => uuidStr((await headOf(contest))?.buildId) !== first,
      10_000,
    );
    const events = await expectFinalFrameStored(contest);
    expect(events.map((event) => event[0])).toEqual([300, 3000]);
  });

  it('queues no rebuild for a late verdict of a virtual or spectating row, or one graded while the contest runs', async () => {
    const add = jest.spyOn(Queue.prototype, 'add');
    const replayAdds = () =>
      add.mock.contexts.filter(
        (queue) => (queue as Queue).name === CONTEST_REPLAY_QUEUE,
      ).length;
    try {
      const ended = await contestOf();
      const running = await contestOf({
        endTime: new Date(Date.now() + HOUR),
      });
      const rows = [
        await join(ended, { virtual: 1 }),
        await join(ended, { virtual: -1 }),
        await join(running),
      ];
      for (const row of rows) {
        const submission = await seedContestSubmission(worker, row, sum._id);
        await effects.applyContest(submission._id);
      }
      expect(replayAdds()).toBe(0);
      const live = await join(ended);
      const submission = await seedContestSubmission(worker, live, sum._id);
      await effects.applyContest(submission._id);
      expect(replayAdds()).toBe(1);
    } finally {
      add.mockRestore();
    }
  });

  it('writes no head before the end plus the settle time, and drops a head built earlier', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    await service.build(contest._id);
    expect(await headOf(contest)).not.toBeNull();
    await worker.contests.updateOne(
      { _id: contest._id },
      { endTime: new Date(Date.now() + HOUR) },
    );
    expect(await service.build(contest._id)).toEqual({ events: 0 });
    expect(await headOf(contest)).toBeNull();
    expect(
      await worker.replayChunks.countDocuments({ contest: contest._id }),
    ).toBe(0);
    const justEnded = new Date(Date.now() - 2 * MINUTE);
    await worker.contests.updateOne(
      { _id: contest._id },
      { endTime: justEnded },
    );
    expect(await service.build(contest._id)).toEqual({ events: 0 });
    expect(await headOf(contest)).toBeNull();
    const settled = new Date(justEnded.getTime() + REPLAY_SETTLE_MS);
    await service.build(contest._id, { now: settled });
    expect((await headOf(contest))!.builtAt.getTime()).toBe(settled.getTime());
  });

  it('writes no head while the contest runs, whatever was submitted', async () => {
    const contest = await contestOf({ endTime: new Date(Date.now() + HOUR) });
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    expect(await service.build(contest._id)).toEqual({ events: 0 });
    expect(await headOf(contest)).toBeNull();
    expect(
      await worker.replayChunks.countDocuments({ contest: contest._id }),
    ).toBe(0);
  });

  it("a queued job on an ended contest makes the head appear, with the participation's events", async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    expect(await headOf(contest)).toBeNull();
    expect(
      await processor.process({ data: { contestId: contest._id } } as never),
    ).toEqual({ events: 1 });
    expect((await headOf(contest))!.participants).toHaveLength(1);
    expect(await eventsOf(contest)).toHaveLength(1);
  });

  it('stores an empty first chunk for a contest with registrants and no submissions', async () => {
    const contest = await contestOf();
    await join(contest, { isRegistered: true });
    await service.build(contest._id);
    const head = (await headOf(contest))!;
    expect(head.chunkCount).toBe(1);
    expect(head.participants).toHaveLength(1);
    expect(await eventsOf(contest)).toEqual([]);
  });

  it('lists live participations, registered ones with no events, and leaves out disqualified, virtual and spectating rows', async () => {
    const contest = await contestOf();
    const live = await join(contest);
    const registered = await join(contest, { isRegistered: true });
    await join(contest, { isDisqualified: true });
    await join(contest, { virtual: 1 });
    await join(contest, { virtual: -1 });
    await submit(contest, live, sum, { after: 5, result: 'AC', points: 100 });
    await service.build(contest._id);
    const head = (await headOf(contest))!;
    expect(
      head.participants
        .map((participant) => uuidStr(participant.participationId))
        .sort(),
    ).toEqual([live._id, registered._id].sort());
    const events = await eventsOf(contest);
    const registeredIndex = head.participants.findIndex(
      (participant) => uuidStr(participant.participationId) === registered._id,
    );
    expect(events.filter((event) => event[1] === registeredIndex)).toEqual([]);
    expect(events).toHaveLength(1);
  });

  it("times a windowed contest's events from each participation's own start", async () => {
    const contest = await contestOf({ timeLimit: 3600 });
    const joinedLate = new Date(contest.startTime.getTime() + 30 * MINUTE);
    const late = await join(contest, { realStart: joinedLate });
    await submit(contest, late, sum, {
      after: 5,
      from: joinedLate,
      result: 'AC',
      points: 100,
    });
    await service.build(contest._id);
    expect((await eventsOf(contest))[0][0]).toBe(300);
  });

  it('scores stored ghosts once, ranked ones first, into a ghost stream the head describes', async () => {
    const contest = await contestOf({ formatName: 'icpc' });
    await join(contest);
    await worker.ghosts.create([
      {
        contest: contest._id,
        label: 'Ann',
        caption: 'A',
        cells: [{ problemId: sum._id, minute: 12 }],
      },
      {
        contest: contest._id,
        label: 'Bob',
        caption: '',
        cells: [{ problemId: sum._id, minute: 12, rejectedBefore: 2 }],
      },
    ]);
    await service.build(contest._id);
    const head = (await headOf(contest))!;
    expect(
      head.ghosts.map((ghost) => [ghost.label, ghost.isUnranked, ghost.gap]),
    ).toEqual([
      ['Bob', false, null],
      ['Ann', true, 'rejectedBefore'],
    ]);
    const events = await streamOf(contest, 'ghost');
    expect(head.ghostChunkCount).toBe(1);
    expect(events).toHaveLength(1);
    expect([events[0][0], events[0][1]]).toEqual([720, 0]);
    expect(events[0].slice(4)).toEqual([100, 52, 12]);
  });

  it('replaces the previous build and removes its chunks, both streams', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    await service.build(contest._id);
    const first = (await headOf(contest))!;
    await service.build(contest._id);
    const second = (await headOf(contest))!;
    expect(uuidStr(second.buildId)).not.toBe(uuidStr(first.buildId));
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: first.buildId,
      }),
    ).toBe(0);
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: second.buildId,
      }),
    ).toBe(second.chunkCount + second.ghostChunkCount);
  });

  it('never deletes the chunks of a build that started later and is still being written', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    await service.build(contest._id);
    const old = (await headOf(contest))!.buildId;
    let later = '';
    const swap = repository.replaceHead.bind(repository);
    jest
      .spyOn(repository, 'replaceHead')
      .mockImplementationOnce(async (head) => {
        later = newId();
        // A second run, started after this one, has written a chunk and not yet its head.
        await worker.replayChunks.create({
          contest: contest._id,
          buildId: later,
          stream: 'real',
          chunk: 0,
          events: [],
        });
        return swap(head);
      });
    await service.build(contest._id);
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: later,
      }),
    ).toBe(1);
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: old,
      }),
    ).toBe(0);
  });

  it('leaves the head of a build that started later, and drops its own chunks, when it finishes last', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    let later = '';
    const swap = repository.replaceHead.bind(repository);
    let overtaken = '';
    jest
      .spyOn(repository, 'replaceHead')
      .mockImplementationOnce(async (head) => {
        overtaken = head.buildId;
        later = newId();
        // The later run finished first.
        await worker.replayChunks.create({
          contest: contest._id,
          buildId: later,
          stream: 'real',
          chunk: 0,
          events: [],
        });
        await swap({ ...head, buildId: later });
        return swap(head);
      });
    await service.build(contest._id);
    expect(uuidStr((await headOf(contest))!.buildId)).toBe(later);
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: overtaken,
      }),
    ).toBe(0);
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: later,
      }),
    ).toBe(1);
  });

  it('keeps serving the previous build when a rebuild dies before the head swap', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    await service.build(contest._id);
    const before = (await headOf(contest))!;
    const eventsBefore = await eventsOf(contest);
    jest
      .spyOn(repository, 'replaceHead')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(service.build(contest._id)).rejects.toThrow('boom');
    expect(uuidStr((await headOf(contest))!.buildId)).toBe(
      uuidStr(before.buildId),
    );
    expect(await eventsOf(contest)).toEqual(eventsBefore);
    await service.build(contest._id);
    expect(
      await worker.replayChunks.countDocuments({
        contest: contest._id,
        buildId: { $ne: (await headOf(contest))!.buildId },
      }),
    ).toBe(0);
  });

  it('refuses a build above the event limit and keeps the previous head', async () => {
    const contest = await contestOf();
    const ann = await join(contest);
    await submit(contest, ann, sum, { after: 5, result: 'AC', points: 100 });
    await submit(contest, ann, max, { after: 8, result: 'AC', points: 100 });
    await service.build(contest._id);
    const before = (await headOf(contest))!;
    await expect(service.build(contest._id, { maxEvents: 1 })).rejects.toThrow(
      /replay_too_large/,
    );
    expect(uuidStr((await headOf(contest))!.buildId)).toBe(
      uuidStr(before.buildId),
    );
  });

  it('drops the replay of a contest that became final-submission, and of one that vanished', async () => {
    const contest = await contestOf();
    await service.build(contest._id);
    expect(await headOf(contest)).not.toBeNull();
    await worker.contests.updateOne(
      { _id: contest._id },
      { formatName: 'final_submission' },
    );
    expect(await service.build(contest._id)).toEqual({ events: 0 });
    expect(await headOf(contest)).toBeNull();
    expect(
      await worker.replayChunks.countDocuments({ contest: contest._id }),
    ).toBe(0);
    expect(await service.build(newId())).toEqual({ events: 0 });
  });
});
