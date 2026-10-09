import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  NOTIFICATION_CAP_PER_USER,
  NOTIFICATION_TRIM_JOB,
  NOTIFICATION_TRIM_PATTERN,
  NOTIFICATION_TRIM_QUEUE,
} from '@libs/community';
import { newId } from '@libs/database';
import { NotificationTrimProcessor } from '../src/jobs/notification-trim/notification-trim.processor';
import { NotificationTrimRepository } from '../src/jobs/notification-trim/notification-trim.repository';
import { NotificationTrimService } from '../src/jobs/notification-trim/notification-trim.service';
import {
  OVER_CAP_SCAN_INDEX,
  overCapUsersPipeline,
  newestFirstQuery,
} from '../src/jobs/notification-trim/notification-trim.repository';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe('notification trim', () => {
  let worker: WorkerTest;
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

  beforeAll(async () => {
    worker = await setupWorkerTest();
    trims = worker.module.get(NotificationTrimService);
  });
  afterAll(() => worker.teardown());
  beforeEach(() => worker.notifications.deleteMany({}));

  it('keeps the newest 500 rows of a user over the cap, read or unread, and deletes the older ones', async () => {
    const user = newId();
    await seed(user, NOTIFICATION_CAP_PER_USER + 20, 0);
    expect(await trims.trim()).toEqual({ users: 1, deleted: 20 });
    expect(await countOf(user)).toBe(NOTIFICATION_CAP_PER_USER);
    const oldest = Array.from({ length: 20 }, (_unused, index) => `t${index}`);
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

  it('trims each over-cap user separately', async () => {
    const [one, two] = [newId(), newId()];
    await seed(one, NOTIFICATION_CAP_PER_USER + 5, 0);
    await seed(two, NOTIFICATION_CAP_PER_USER + 7, MINUTE);
    expect(await trims.trim()).toEqual({ users: 2, deleted: 12 });
    expect([await countOf(one), await countOf(two)]).toEqual([500, 500]);
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
    expect(schedulers[0]).toMatchObject({ pattern: NOTIFICATION_TRIM_PATTERN });
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
