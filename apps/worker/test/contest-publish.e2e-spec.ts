import { getModelToken } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import type { Model } from 'mongoose';
import { Group, newId, toUuid } from '@libs/database';
import type { Problem } from '@libs/database';
import { ContestPublishRepository } from '../src/jobs/contest-publish/contest-publish.repository';
import { ContestPublishService } from '../src/jobs/contest-publish/contest-publish.service';
import { seedContest, seedProblem, seedUser } from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const hours = (count: number) => new Date(Date.now() + count * 3_600_000);
const RIGHTS = [
  'judge.edit_own_contest',
  'judge.edit_own_problem',
  'judge.change_public_visibility',
];
const solution = () => ({
  isPublic: false,
  publishOn: new Date(),
  authors: [],
  content: 'e',
  contentHtml: '<p>e</p>',
});

describe('automatic publish after the contest', () => {
  let worker: WorkerTest;
  let service: ContestPublishService;
  let rescoreAdd: jest.SpyInstance<Promise<unknown>, unknown[]>;
  let contributionAddBulk: jest.SpyInstance<Promise<unknown>, unknown[]>;
  const isPublic = async (problem: Problem) =>
    (await worker.problems.findById(problem._id).lean())!.isPublic;
  const outcomeOf = async (contestId: string) =>
    (await worker.contests.findById(contestId).lean())!.autoPublishOutcome;
  /** An ended contest with the switch on, recorded for `editor`, holding the given problems. */
  const contestOf = (
    editorId: string | null,
    problems: Problem[],
    extra = {},
  ) =>
    seedContest(worker, {
      startTime: hours(-5),
      endTime: hours(-1),
      publishAfterEnd: true,
      publishAfterEndBy: editorId,
      authors: editorId ? [editorId] : [],
      problems: problems.map((problem, order) => ({
        problem: problem._id,
        points: 100,
        order,
        partial: true,
        isPretested: false,
        outputPrefixOverride: null,
        maxSubmissions: null,
      })),
      ...extra,
    });

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ContestPublishService);
    // Each queue is registered in several modules, so spy on the prototype; the calls are mocked so the worker's own processors do not run the jobs.
    rescoreAdd = jest
      .spyOn(Queue.prototype, 'add')
      .mockResolvedValue(undefined as never);
    contributionAddBulk = jest
      .spyOn(Queue.prototype, 'addBulk')
      .mockResolvedValue([]);
  });
  afterAll(async () => {
    rescoreAdd.mockRestore();
    contributionAddBulk.mockRestore();
    await worker.teardown();
  });
  beforeEach(() => {
    rescoreAdd.mockClear();
    contributionAddBulk.mockClear();
  });

  it('publishes what the recorded editor may, records the outcome and queues the rescores', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const own = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const withEditorial = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
      solution: solution(),
    });
    const orgPrivate = await seedProblem(worker, {
      isPublic: false,
      isOrganizationPrivate: true,
      organizations: [newId()],
      authors: [editor._id],
    });
    const foreign = await seedProblem(worker, {
      isPublic: false,
      authors: [newId()],
    });
    const contest = await contestOf(editor._id, [
      own,
      withEditorial,
      orgPrivate,
      foreign,
    ]);

    expect(await service.run(contest._id)).toBe('published');

    expect(
      await Promise.all(
        [own, withEditorial, orgPrivate, foreign].map(isPublic),
      ),
    ).toEqual([true, true, false, false]);
    const released = (await worker.problems
      .findById(withEditorial._id)
      .lean())!;
    expect(released.solution).toMatchObject({ isPublic: true });
    expect(await outcomeOf(contest._id)).toMatchObject({
      status: 'published',
      reason: '',
      published: 2,
      skipped: 2,
    });
    const revisions = await worker.db
      .collection('revisions')
      .find({ entityId: toUuid(own._id) })
      .toArray();
    expect(revisions.map((revision) => revision.action as string)).toContain(
      'edit',
    );
    expect(
      rescoreAdd.mock.calls
        .map(
          (call: unknown[]) => (call[1] as { problemId?: string })?.problemId,
        )
        .filter(Boolean)
        .sort(),
    ).toEqual([own._id, withEditorial._id].sort());
  });

  it('honours rights the editor holds through a group', async () => {
    const groups = worker.module.get<Model<Group>>(getModelToken(Group.name));
    const group = await groups.create({
      name: 'Publishers',
      permissions: RIGHTS,
    });
    const editor = await seedUser(worker, { groups: [group._id] });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem]);
    expect(await service.run(contest._id)).toBe('published');
    expect(await isPublic(problem)).toBe(true);
  });

  it('treats a contest row without an outcome field as due', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem]);
    await worker.db
      .collection('contests')
      .updateOne(
        { _id: toUuid(contest._id) as never },
        { $unset: { autoPublishOutcome: '' } },
      );
    expect(await service.run(contest._id)).toBe('published');
    expect(await isPublic(problem)).toBe(true);
  });

  it('does not publish or release a problem deleted after it was read', async () => {
    const repository = worker.module.get(ContestPublishRepository);
    const problem = await seedProblem(worker, {
      isPublic: false,
      solution: solution(),
      deletedAt: new Date(),
    });
    const stored = (await worker.problems.findById(problem._id).lean())!;
    expect(
      await repository.publishProblem(problem._id, {
        contestKey: 'k',
        actorId: newId(),
      }),
    ).toBe(false);
    expect(
      await repository.releaseEditorial(stored, {
        actorId: newId(),
        now: new Date(),
      }),
    ).toBe(false);
  });

  it('records a failure when the recorded editor no longer edits the contest', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem], { authors: [] });
    expect(await service.run(contest._id)).toBe('failed');
    expect(await isPublic(problem)).toBe(false);
    expect((await outcomeOf(contest._id))!.reason).toBe('cannot_edit_contest');
  });

  it('queues the rescore and counts a problem a crashed run had already published', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const problem = await seedProblem(worker, {
      isPublic: true,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem]);
    await worker.db.collection('revisions').insertOne({
      entity: 'problem',
      entityId: toUuid(problem._id),
      action: 'edit',
      comment: `Published after contest ${contest.key}`,
    });
    expect(await service.run(contest._id)).toBe('published');
    expect(await outcomeOf(contest._id)).toMatchObject({ published: 1 });
    expect(
      rescoreAdd.mock.calls.map(
        (call: unknown[]) => (call[1] as { problemId?: string })?.problemId,
      ),
    ).toContain(problem._id);
  });

  it('leaves a problem that was public before the contest alone', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const problem = await seedProblem(worker, {
      isPublic: true,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem]);
    await service.run(contest._id);
    expect(rescoreAdd).not.toHaveBeenCalled();
    expect(await outcomeOf(contest._id)).toMatchObject({ published: 0 });
  });

  it('does nothing the second time', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem]);
    expect(await service.run(contest._id)).toBe('published');
    rescoreAdd.mockClear();
    expect(await service.run(contest._id)).toBe('skipped');
    expect(rescoreAdd).not.toHaveBeenCalled();
  });

  it('publishes nothing and records a failure when the editor lost change_public_visibility', async () => {
    const editor = await seedUser(worker, {
      permissions: ['judge.edit_own_problem'],
    });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const contest = await contestOf(editor._id, [problem]);
    expect(await service.run(contest._id)).toBe('failed');
    expect(await isPublic(problem)).toBe(false);
    expect(await outcomeOf(contest._id)).toMatchObject({
      status: 'failed',
      reason: 'no_permission',
      published: 0,
      skipped: 1,
    });
  });

  it('publishes nothing and records a failure when the editor is deactivated or unknown', async () => {
    const gone = await seedUser(worker, {
      permissions: RIGHTS,
      isActive: false,
    });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [gone._id],
    });
    const deactivated = await contestOf(gone._id, [problem]);
    const unknown = await contestOf(null, [problem]);
    expect(await service.run(deactivated._id)).toBe('failed');
    expect(await service.run(unknown._id)).toBe('failed');
    expect(await isPublic(problem)).toBe(false);
    expect((await outcomeOf(deactivated._id))!.reason).toBe(
      'actor_unavailable',
    );
    expect((await outcomeOf(unknown._id))!.reason).toBe('actor_unavailable');
  });

  it('does nothing and records nothing before the end or with the switch off', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const early = await contestOf(editor._id, [problem], { endTime: hours(2) });
    const off = await contestOf(editor._id, [problem], {
      publishAfterEnd: false,
    });
    expect(await service.run(early._id)).toBe('skipped');
    expect(await service.run(off._id)).toBe('skipped');
    expect(await isPublic(problem)).toBe(false);
    expect(await outcomeOf(early._id)).toBeNull();
    expect(await outcomeOf(off._id)).toBeNull();
  });

  it('refreshes the contribution points of the suggester when a suggested problem turns public', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const suggester = await seedUser(worker);
    const problem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
      suggester: suggester._id,
    });
    const contest = await contestOf(editor._id, [problem]);
    await service.run(contest._id);
    expect(await isPublic(problem)).toBe(true);
    const queued = contributionAddBulk.mock.calls.flatMap(
      (call) => call[0] as Array<{ data: { userId: string } }>,
    );
    expect(queued.map((job) => job.data.userId)).toEqual([suggester._id]);
  });

  it('skips a deleted problem as missing', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const deleted = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
      deletedAt: new Date(),
    });
    const contest = await contestOf(editor._id, [deleted]);
    await service.run(contest._id);
    expect(await isPublic(deleted)).toBe(false);
    expect(await outcomeOf(contest._id)).toMatchObject({
      published: 0,
      skipped: 1,
    });
  });

  it('records one revision when two runs release the same editorial', async () => {
    const repository = worker.module.get(ContestPublishRepository);
    const problem = await seedProblem(worker, {
      isPublic: true,
      solution: solution(),
    });
    const note = { actorId: newId(), now: new Date() };
    const stored = (await worker.problems.findById(problem._id).lean())!;
    const outcomes = await Promise.all([
      repository.releaseEditorial(stored, note),
      repository.releaseEditorial(stored, note),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const revisions = await worker.db
      .collection('revisions')
      .find({ entityId: toUuid(problem._id), action: 'editorial' })
      .toArray();
    expect(revisions).toHaveLength(1);
  });

  it('sweeps the ended contests that are still due and leaves the rest', async () => {
    const editor = await seedUser(worker, { permissions: RIGHTS });
    const dueProblem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    const otherProblem = await seedProblem(worker, {
      isPublic: false,
      authors: [editor._id],
    });
    await contestOf(editor._id, [dueProblem]);
    await contestOf(editor._id, [otherProblem], { publishAfterEnd: false });
    expect(await service.sweep()).toBe(1);
    expect(await isPublic(dueProblem)).toBe(true);
    expect(await isPublic(otherProblem)).toBe(false);
  });
});
