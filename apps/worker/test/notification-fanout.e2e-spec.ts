import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  NOTIFICATION_FANOUT_JOB,
  NOTIFICATION_FANOUT_QUEUE,
} from '@libs/community';
import { newId } from '@libs/database';
import type { Contest, ContestParticipation } from '@libs/database';
import { NotificationFanoutService } from '../src/jobs/notification-fanout/notification-fanout.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

const minutesFromNow = (offset: number) =>
  new Date(Date.now() + offset * 60_000);

describe('notification fan-out', () => {
  let worker: WorkerTest;
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
  const announcement = (contestId: string, title: string) =>
    worker.announcements.create({
      contest: contestId,
      title,
      description: '',
      descriptionHtml: '',
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

  beforeAll(async () => {
    worker = await setupWorkerTest();
    fanout = worker.module.get(NotificationFanoutService);
  });
  afterAll(() => worker.teardown());
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
    await join(round._id, user, { virtual: 1, realStart: minutesFromNow(-5) });
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
    await expect(fanout.announce(saved._id)).resolves.toBeGreaterThanOrEqual(0);
    await fanout.announce(saved._id);
    const rows = await rowsOf(user);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
  });

  it('writes every recipient of a large contest across chunks', async () => {
    const round = await contest();
    const users = Array.from({ length: 1200 }, newId);
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
    ).toBe(1200);
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
