import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  NOTIFICATION_FANOUT_JOB,
  NOTIFICATION_FANOUT_QUEUE,
} from '@libs/community';
import { newId } from '@libs/database';
import type { Contest, ContestParticipation } from '@libs/database';
import { NotificationFanoutRepository } from '../src/jobs/notification-fanout/notification-fanout.repository';
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
