import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  NOTIFICATION_CAP_PER_USER,
  NOTIFICATION_TRIM_JOB,
  NOTIFICATION_TRIM_PATTERN,
  NOTIFICATION_TRIM_QUEUE,
  NOTIFICATION_FANOUT_JOB,
  NOTIFICATION_FANOUT_QUEUE,
} from '@libs/community';
import { newId } from '@libs/database';
import { NotificationTrimProcessor } from '../src/jobs/notification-trim/notification-trim.processor';
import {
  NotificationTrimRepository,
  OVER_CAP_SCAN_INDEX,
  overCapUsersPipeline,
  newestFirstQuery,
} from '../src/jobs/notification-trim/notification-trim.repository';
import { NotificationTrimService } from '../src/jobs/notification-trim/notification-trim.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';
import type { Contest, ContestParticipation } from '@libs/database';
import { NotificationFanoutRepository } from '../src/jobs/notification-fanout/notification-fanout.repository';
import { NotificationFanoutService } from '../src/jobs/notification-fanout/notification-fanout.service';
import { gradedJobOf } from '@libs/judging';
import type { PolygonImportJob } from '@libs/problems';
import { ContestDataRepository } from '../src/jobs/contest-data/contest-data.repository';
import { ContributionPointsRepository } from '../src/jobs/contribution-points/contribution-points.repository';
import { PdfRenderRepository } from '../src/jobs/pdf-render/pdf-render.repository';
import { PolygonImportRepository } from '../src/jobs/polygon-import/polygon-import.repository';
import { ContestResultsRepository } from '../src/jobs/submission-effects/contest-results.repository';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import { softDeleteWorker, undeleteWorker } from './deleted-problem-fixtures';
import {
  seedContest,
  seedGraded,
  seedProblem,
  seedUser,
} from './effects-fixtures';

let worker: WorkerTest;

beforeAll(async () => {
  worker = await setupWorkerTest();
});
afterAll(() => worker.teardown());

// from notification-trim.e2e-spec.ts
{
  const MINUTE = 60_000;
  const DAY = 24 * 60 * MINUTE;

  describe('notification trim', () => {
    beforeAll(() => worker.reset());
    let trims: NotificationTrimService;
    /** Row `index` of `count`: index 0 is the oldest, one minute apart, the newest `endsAgo` before now. */
    const seed = (user: string, count: number, endsAgo: number) => {
      const now = Date.now();
      return worker.notifications.insertMany(
        Array.from({ length: count }, (_unused, index) => {
          const at = new Date(now - endsAgo - (count - 1 - index) * MINUTE);
          return {
            user,
            kind: 'ticket-message' as const,
            title: `t${index}`,
            body: '',
            path: '/tickets/1',
            priority: 'normal' as const,
            groupKey: `g${index}`,
            count: 1,
            unread: index % 2 === 0,
            readAt: null,
            refs: [],
            lastActivityAt: at,
            createdAt: at,
            expiresAt: new Date(at.getTime() + 90 * DAY),
          };
        }),
      );
    };
    const countOf = (user: string) =>
      worker.notifications.countDocuments({ user });

    beforeAll(() => {
      trims = worker.module.get(NotificationTrimService);
    });
    beforeEach(() => worker.notifications.deleteMany({}));

    it('keeps the newest 500 rows of a user over the cap, read or unread, and deletes the older ones', async () => {
      const user = newId();
      await seed(user, NOTIFICATION_CAP_PER_USER + 20, 0);
      expect(await trims.trim()).toEqual({ users: 1, deleted: 20 });
      expect(await countOf(user)).toBe(NOTIFICATION_CAP_PER_USER);
      const oldest = Array.from(
        { length: 20 },
        (_unused, index) => `t${index}`,
      );
      expect(
        await worker.notifications.countDocuments({
          user,
          title: { $in: oldest },
        }),
      ).toBe(0);
      expect(
        await worker.notifications.countDocuments({ user, title: 't20' }),
      ).toBe(1);
    });

    it('leaves users at or under the cap alone', async () => {
      const exact = newId();
      const small = newId();
      await seed(exact, NOTIFICATION_CAP_PER_USER, 0);
      await seed(small, 3, 0);
      expect(await trims.trim()).toEqual({ users: 0, deleted: 0 });
      expect(await countOf(exact)).toBe(NOTIFICATION_CAP_PER_USER);
      expect(await countOf(small)).toBe(3);
    });

    it('trims a user over the cap whose last activity is days old (a skipped night leaves nobody behind)', async () => {
      const dormant = newId();
      await seed(dormant, NOTIFICATION_CAP_PER_USER + 10, 3 * DAY);
      expect(await trims.trim()).toEqual({ users: 1, deleted: 10 });
      expect(await countOf(dormant)).toBe(NOTIFICATION_CAP_PER_USER);
    });

    it('spares a row that a merge moved between the read and the delete', async () => {
      const user = newId();
      await seed(user, NOTIFICATION_CAP_PER_USER + 2, 0);
      const repository = worker.module.get(NotificationTrimRepository);
      const candidates = await repository.beyondNewest(
        user,
        NOTIFICATION_CAP_PER_USER,
        10,
      );
      expect(candidates).toHaveLength(2);
      const [merged, stale] = candidates;
      await worker.notifications.updateOne(
        { _id: merged.id },
        { $set: { lastActivityAt: new Date() } },
      );
      expect(await repository.deleteUnchanged(candidates)).toBe(1);
      expect(
        await worker.notifications.exists({ _id: merged.id }),
      ).not.toBeNull();
      expect(await worker.notifications.exists({ _id: stale.id })).toBeNull();
    });

    it('finds the over-cap users and the newest rows through indexes, not a collection scan', async () => {
      const overCapPlan = JSON.stringify(
        await worker.notifications
          .aggregate(overCapUsersPipeline(NOTIFICATION_CAP_PER_USER))
          .hint(OVER_CAP_SCAN_INDEX)
          .explain('queryPlanner'),
      );
      expect(overCapPlan).toContain('IXSCAN');
      expect(overCapPlan).not.toContain('COLLSCAN');
      const newest = (await newestFirstQuery(worker.notifications, newId())
        .skip(NOTIFICATION_CAP_PER_USER)
        .limit(1000)
        .explain('queryPlanner')) as unknown as {
        queryPlanner: { winningPlan: unknown };
      };
      const newestPlan = JSON.stringify(newest.queryPlanner.winningPlan);
      expect(newestPlan).toContain('IXSCAN');
      expect(newestPlan).not.toContain('COLLSCAN');
      expect(newestPlan).not.toContain('"SORT"');
    });

    it('keeps one nightly schedule however many worker processes boot', async () => {
      const processor = worker.module.get(NotificationTrimProcessor);
      await processor.onApplicationBootstrap();
      await processor.onApplicationBootstrap();
      const queue = worker.module.get<Queue>(
        getQueueToken(NOTIFICATION_TRIM_QUEUE),
      );
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]).toMatchObject({
        pattern: NOTIFICATION_TRIM_PATTERN,
      });
    });

    it('is consumed from the queue by the processor', async () => {
      const user = newId();
      await seed(user, NOTIFICATION_CAP_PER_USER + 3, 0);
      const queue = worker.module.get<Queue>(
        getQueueToken(NOTIFICATION_TRIM_QUEUE),
      );
      await queue.add(NOTIFICATION_TRIM_JOB, {});
      await waitUntil(
        async () => (await countOf(user)) === NOTIFICATION_CAP_PER_USER,
      );
    });
  });
}

// from notification-fanout.e2e-spec.ts
{
  const minutesFromNow = (offset: number) =>
    new Date(Date.now() + offset * 60_000);

  describe('notification fan-out', () => {
    beforeAll(() => worker.reset());
    let fanout: NotificationFanoutService;
    let contestCount = 0;
    const contest = (overrides: Partial<Contest> = {}) =>
      worker.contests.create({
        key: `round_${(contestCount += 1)}`,
        name: 'Vòng loại',
        startTime: minutesFromNow(-60),
        endTime: minutesFromNow(120),
        isVisible: true,
        ...overrides,
      });
    const announcement = (
      contestId: string,
      title: string,
      createdAt = new Date(),
    ) =>
      worker.announcements.create({
        contest: contestId,
        title,
        description: '',
        descriptionHtml: '',
        createdAt,
      });
    const join = (
      contestId: string,
      user: string,
      overrides: Partial<ContestParticipation> = {},
    ) =>
      worker.participations.create({
        contest: contestId,
        user,
        realStart: minutesFromNow(-30),
        virtual: 0,
        ...overrides,
      });
    const rowsOf = (user: string) =>
      worker.notifications.find({ user }).sort({ _id: 1 }).lean();

    beforeAll(() => {
      fanout = worker.module.get(NotificationFanoutService);
    });
    beforeEach(() => worker.notifications.deleteMany({}));

    it('writes one high-priority row per recipient: live and running virtual yes, spectator and finished virtual no', async () => {
      const round = await contest();
      const [live, registered, running, spectator, finished] = [
        newId(),
        newId(),
        newId(),
        newId(),
        newId(),
      ];
      await join(round._id, live);
      await join(round._id, registered, { isRegistered: true });
      await join(round._id, running, {
        virtual: 1,
        realStart: minutesFromNow(-10),
      });
      await join(round._id, spectator, { virtual: -1 });
      await join(round._id, finished, {
        virtual: 1,
        realStart: minutesFromNow(-600),
      });
      const saved = await announcement(round._id, 'Đổi phòng thi');

      expect(await fanout.announce(saved._id)).toBe(3);

      for (const user of [live, registered, running]) {
        const [row] = await rowsOf(user);
        expect(row).toMatchObject({
          kind: 'contest-announcement',
          priority: 'high',
          unread: true,
          count: 1,
          groupKey: `contest-ann:${round._id}`,
          body: 'Đổi phòng thi',
          path: `/contests/${round.key}/announcements`,
        });
      }
      expect(await rowsOf(spectator)).toHaveLength(0);
      expect(await rowsOf(finished)).toHaveLength(0);
    });

    it('gives a user with a live and a running virtual row one notification', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      await join(round._id, user, {
        virtual: 1,
        realStart: minutesFromNow(-5),
      });
      const recipients = await fanout.announce(
        (await announcement(round._id, 'A'))._id,
      );
      expect(recipients).toBe(1);
      expect(await rowsOf(user)).toHaveLength(1);
    });

    it('merges the next announcement into the unread row and opens a fresh row after it was read', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      await fanout.announce((await announcement(round._id, 'First'))._id);
      await fanout.announce((await announcement(round._id, 'Second'))._id);
      let rows = await rowsOf(user);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ count: 2, body: 'Second' });
      await worker.notifications.updateOne(
        { user },
        { $set: { unread: false, readAt: new Date() } },
      );
      await fanout.announce((await announcement(round._id, 'Third'))._id);
      rows = await rowsOf(user);
      expect(rows.map((row) => [row.unread, row.count])).toEqual([
        [false, 2],
        [true, 1],
      ]);
    });

    it('is idempotent: a retried job does not count the same announcement twice', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const saved = await announcement(round._id, 'Once');
      await fanout.announce(saved._id);
      await expect(fanout.announce(saved._id)).resolves.toBe(1);
      await fanout.announce(saved._id);
      const rows = await rowsOf(user);
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(1);
    });

    it('a retry after the user read the row opens no second unread row', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const saved = await announcement(round._id, 'Read meanwhile');
      await fanout.announce(saved._id);
      await worker.notifications.updateOne(
        { user },
        { $set: { unread: false, readAt: new Date() } },
      );
      await fanout.announce(saved._id);
      const rows = await rowsOf(user);
      expect(rows.map((row) => [row.unread, row.count])).toEqual([[false, 1]]);
    });

    it('a delayed retry of an older announcement neither counts again nor puts its text back on top', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const older = await announcement(round._id, 'Older', minutesFromNow(-5));
      const newer = await announcement(round._id, 'Newer');
      await fanout.announce(older._id);
      await fanout.announce(newer._id);
      await fanout.announce(older._id);
      const [row] = await rowsOf(user);
      expect(row).toMatchObject({ count: 2, body: 'Newer' });
      expect(row.lastActivityAt).toEqual(newer.createdAt);
    });

    it('applied out of order, the newest announcement still shows on top with both counted', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const older = await announcement(round._id, 'Older', minutesFromNow(-5));
      const newer = await announcement(round._id, 'Newer');
      await fanout.announce(newer._id);
      await fanout.announce(older._id);
      const [row] = await rowsOf(user);
      expect(row).toMatchObject({ count: 2, body: 'Newer' });
    });

    it('merges a user whose insert lost to a concurrent writer, and still writes the texts of the rest of the chunk', async () => {
      const round = await contest();
      const [loser, other] = [newId(), newId()];
      await join(round._id, loser);
      await join(round._id, other);
      const older = await announcement(round._id, 'Older', minutesFromNow(-5));
      const newer = await announcement(round._id, 'Newer');
      await fanout.announce(older._id);
      const loserOlderRow = await worker.notifications.findOne({ user: loser });
      await worker.notifications.deleteMany({ user: loser });
      // The first merge of `newer` loses for `loser`: the competing row appears between its match check and its insert.
      const model = Reflect.get(
        worker.module.get(NotificationFanoutRepository),
        'notifications',
      ) as typeof worker.notifications;
      const bulkWrite = model.bulkWrite.bind(model);
      jest
        .spyOn(model, 'bulkWrite')
        .mockImplementationOnce(async (ops, options) => {
          const index = ops.findIndex(
            (op) => 'updateOne' in op && op.updateOne.filter.user === loser,
          );
          await bulkWrite(
            ops.filter((_op, at) => at !== index),
            options,
          );
          await worker.notifications.create(loserOlderRow!.toObject());
          throw Object.assign(new Error('E11000'), {
            writeErrors: [{ index, code: 11000 }],
          });
        });
      await fanout.announce(newer._id);
      jest.restoreAllMocks();
      for (const user of [loser, other]) {
        const rows = await rowsOf(user);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ count: 2, body: 'Newer' });
      }
    });

    it('a retry repairs the text a failed run left stale, without counting again', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const older = await announcement(round._id, 'Older', minutesFromNow(-5));
      const newer = await announcement(round._id, 'Newer');
      await fanout.announce(older._id);
      await fanout.announce(newer._id);
      // A run that merged `newer` but died before the text step.
      await worker.notifications.updateOne(
        { user },
        { $set: { title: 'Older', body: 'Older' } },
      );
      await fanout.announce(newer._id);
      const [row] = await rowsOf(user);
      expect(row).toMatchObject({ count: 2, body: 'Newer', title: row.title });
      expect(row.title).not.toBe('Older');
    });

    it('expires a row 90 days after processing, even for an old announcement', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const old = await announcement(
        round._id,
        'Old',
        minutesFromNow(-100 * 1440),
      );
      await fanout.announce(old._id);
      const [row] = await rowsOf(user);
      expect(row.expiresAt.getTime()).toBeGreaterThan(
        Date.now() + 80 * 86_400_000,
      );
      expect(row.lastActivityAt).toEqual(old.createdAt);
    });

    it('writes every recipient of a large contest across chunks', async () => {
      const round = await contest();
      // One past a 500-user chunk.
      const users = Array.from({ length: 501 }, newId);
      await worker.participations.insertMany(
        users.map((user) => ({
          contest: round._id,
          user,
          realStart: minutesFromNow(-30),
          virtual: 0,
        })),
      );
      await fanout.announce((await announcement(round._id, 'Big'))._id);
      expect(
        await worker.notifications.countDocuments({
          groupKey: `contest-ann:${round._id}`,
        }),
      ).toBe(501);
    });

    it('cuts the text to the column sizes (a bulk write skips validation)', async () => {
      const round = await contest({ name: 'x'.repeat(100) });
      const user = newId();
      await join(round._id, user);
      await fanout.announce((await announcement(round._id, 'T'))._id);
      const [row] = await rowsOf(user);
      expect([...row.title]).toHaveLength(100);
    });

    it('writes nothing for an announcement or contest that no longer exists', async () => {
      const round = await contest();
      await join(round._id, newId());
      expect(await fanout.announce(newId())).toBe(0);
      const orphan = await announcement(newId(), 'Orphan');
      expect(await fanout.announce(orphan._id)).toBe(0);
      expect(await worker.notifications.countDocuments({})).toBe(0);
    });

    it('is consumed from the queue by the processor', async () => {
      const round = await contest();
      const user = newId();
      await join(round._id, user);
      const saved = await announcement(round._id, 'Queued');
      const queue = worker.module.get<Queue>(
        getQueueToken(NOTIFICATION_FANOUT_QUEUE),
      );
      await queue.add(NOTIFICATION_FANOUT_JOB, { announcementId: saved._id });
      await waitUntil(async () => (await rowsOf(user)).length === 1);
    });
  });
}

// from deleted-problem-readers.e2e-spec.ts
{
  describe('deleted problems in the worker readers', () => {
    beforeAll(() => worker.reset());
    let effects: SubmissionEffectsService;
    const pointsOf = async (userId: string) =>
      (await worker.users
        .findById(userId, { performancePoints: 1, problemCount: 1 })
        .lean())!;

    beforeAll(() => {
      effects = worker.module.get(SubmissionEffectsService);
    });

    it("takes a deleted problem out of a user's points and puts it back exactly on restore", async () => {
      const user = await seedUser(worker);
      const keep = await seedProblem(worker, { points: 1000 });
      const drop = await seedProblem(worker, { points: 1000 });
      await seedGraded(worker, user._id, keep._id);
      await seedGraded(worker, user._id, drop._id);
      await effects.recomputeUser(user._id);
      const before = await pointsOf(user._id);
      expect(before.problemCount).toBe(2);
      await softDeleteWorker(worker, drop._id);
      await effects.recomputeUser(user._id);
      const during = await pointsOf(user._id);
      expect(during.problemCount).toBe(1);
      expect(during.performancePoints).toBeLessThan(before.performancePoints);
      await undeleteWorker(worker, drop._id);
      await effects.recomputeUser(user._id);
      expect(await pointsOf(user._id)).toEqual(before);
    });

    it('ignores a submission that finishes grading while its problem is deleted', async () => {
      const user = await seedUser(worker);
      const problem = await seedProblem(worker);
      await softDeleteWorker(worker, problem._id);
      const submission = await seedGraded(worker, user._id, problem._id);
      await effects.apply(
        gradedJobOf(
          (await worker.submissions.findById(submission._id).lean())!,
        ),
      );
      expect(await pointsOf(user._id)).toMatchObject({
        problemCount: 0,
        performancePoints: 0,
      });
      expect(
        (await worker.problems.findById(problem._id).lean())!.userCount,
      ).toBe(0);
    });

    it('does not count a deleted suggested problem as a public suggestion', async () => {
      const suggester = await seedUser(worker);
      await seedProblem(worker, { suggester: suggester._id });
      const dropped = await seedProblem(worker, { suggester: suggester._id });
      const repository = worker.module.get(ContributionPointsRepository);
      expect((await repository.totals(suggester._id)).publicSuggestions).toBe(
        2,
      );
      await softDeleteWorker(worker, dropped._id);
      expect((await repository.totals(suggester._id)).publicSuggestions).toBe(
        1,
      );
    });

    it('finds no deleted problem for the PDF job, the contest data zip and contest scoring', async () => {
      const problem = await seedProblem(worker, { partial: true });
      const contest = await seedContest(worker, {
        problems: [
          {
            problem: problem._id,
            points: 100,
            order: 0,
            partial: true,
            isPretested: false,
            outputPrefixOverride: null,
            maxSubmissions: null,
          },
        ],
      });
      const pdf = worker.module.get(PdfRenderRepository);
      const data = worker.module.get(ContestDataRepository);
      const results = worker.module.get(ContestResultsRepository);
      expect((await pdf.findByCode(problem.code))?.code).toBe(problem.code);
      expect((await data.findContest(contest._id))!.problems[0].code).toBe(
        problem.code,
      );
      expect((await results.problemPartials([problem._id])).size).toBe(1);
      await softDeleteWorker(worker, problem._id);
      expect(await pdf.findByCode(problem.code)).toBeNull();
      expect((await data.findContest(contest._id))!.problems[0].code).toBe('');
      expect((await results.problemPartials([problem._id])).size).toBe(0);
    });

    it('refuses a Polygon import into the code of a deleted problem, whatever the mode', async () => {
      const problem = await seedProblem(worker);
      await softDeleteWorker(worker, problem._id);
      const repository = worker.module.get(PolygonImportRepository);
      for (const mode of ['create', 'update'] as const)
        await expect(
          repository.resolveTarget({
            code: problem.code,
            mode,
          } as PolygonImportJob),
        ).rejects.toThrow(/is deleted/);
    });
  });
}
