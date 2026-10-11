import { Logger } from '@nestjs/common';
import mongoose from 'mongoose';
import type { Model } from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import type Redis from 'ioredis';
import { newId, NotificationSchema, uuidStr } from '@libs/database';
import type { Notification } from '@libs/database';
import { startMongo } from '@libs/database/testing';
import {
  NOTIFY_RECIPIENT_LIMIT,
  notificationExpiry,
} from './notification-draft';
import type { NotificationDraft } from './notification-draft';
import { NOTIFICATION_EVENTS_CHANNEL } from './notification-events';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 9, 10, minute));
const draft = (
  groupKey: string,
  overrides: Partial<NotificationDraft> = {},
): NotificationDraft => ({
  kind: 'ticket-message',
  title: `Title of ${groupKey}`,
  body: 'body',
  path: '/tickets/1',
  priority: 'normal',
  groupKey,
  ...overrides,
});

describe('NotificationsService', () => {
  let replSet: MongoMemoryReplSet;
  let rows: Model<Notification>;
  let service: NotificationsService;
  let published: Array<{ channel: string; message: string }>;
  let redis: { status: string; publish: jest.Mock };
  const rowsOf = (user: string) =>
    rows.find({ user }).sort({ lastActivityAt: -1, _id: -1 }).lean().exec();

  beforeAll(async () => {
    Logger.overrideLogger(false);
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    rows = mongoose.model('NotificationServiceSpec', NotificationSchema);
    await rows.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });
  beforeEach(async () => {
    await rows.deleteMany({});
    published = [];
    redis = {
      status: 'ready',
      publish: jest.fn((channel: string, message: string) => {
        published.push({ channel, message });
        return Promise.resolve(1);
      }),
    };
    service = new NotificationsService(
      new NotificationsRepository(rows),
      redis as unknown as Redis,
    );
  });

  it('merges a repeated event into the one unread row and moves it to the top', async () => {
    const user = newId();
    await service.notify([user], draft('a'), at(1));
    await service.notify([user], draft('b'), at(2));
    await service.notify([user], draft('a', { title: 'A again' }), at(3));
    const stored = await rowsOf(user);
    expect(stored.map((row) => [row.groupKey, row.title, row.count])).toEqual([
      ['a', 'A again', 2],
      ['b', 'Title of b', 1],
    ]);
    expect(stored[0].lastActivityAt).toEqual(at(3));
  });

  it('opens a fresh unread row once the old one was read', async () => {
    const user = newId();
    await service.notify([user], draft('a'), at(1));
    await rows.updateOne({ user }, { $set: { unread: false, readAt: at(2) } });
    await service.notify([user], draft('a'), at(3));
    const stored = await rowsOf(user);
    expect(stored.map((row) => [row.unread, row.count])).toEqual([
      [true, 1],
      [false, 1],
    ]);
  });

  it('keeps exactly one unread row when twenty events race', async () => {
    const user = newId();
    await Promise.all(
      Array.from({ length: 20 }, () => service.notify([user], draft('burst'))),
    );
    const stored = await rowsOf(user);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ count: 20, unread: true });
  });

  it('never lowers a high priority and raises a normal one', async () => {
    const user = newId();
    await service.notify([user], draft('a', { priority: 'high' }), at(1));
    await service.notify([user], draft('a', { priority: 'normal' }), at(2));
    await service.notify([user], draft('b'), at(3));
    await service.notify([user], draft('b', { priority: 'high' }), at(4));
    const priorities = Object.fromEntries(
      (await rowsOf(user)).map((row) => [row.groupKey, row.priority]),
    );
    expect(priorities).toEqual({ a: 'high', b: 'high' });
  });

  it('refuses a path that leaves the site and writes nothing, without throwing', async () => {
    const user = newId();
    await expect(
      service.notify([user], draft('a', { path: '//evil.com' })),
    ).resolves.toBeUndefined();
    expect(await rowsOf(user)).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it('writes each distinct recipient once, up to the limit', async () => {
    const users = Array.from({ length: NOTIFY_RECIPIENT_LIMIT + 50 }, newId);
    await service.notify([...users, users[0], users[1]], draft('wide'));
    expect(await rows.countDocuments({ groupKey: 'wide' })).toBe(
      NOTIFY_RECIPIENT_LIMIT,
    );
  });

  it('nudges the recipient with the row id only', async () => {
    const user = newId();
    await service.notify([user], draft('a'));
    const [row] = await rowsOf(user);
    expect(published).toEqual([
      {
        channel: NOTIFICATION_EVENTS_CHANNEL,
        message: JSON.stringify({ userId: user, id: uuidStr(row._id) }),
      },
    ]);
  });

  it('still writes the row when Redis is down', async () => {
    redis.status = 'end';
    const user = newId();
    await service.notify([user], draft('a'));
    expect(await rowsOf(user)).toHaveLength(1);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('dismisses only the given users unread rows of the group', async () => {
    const [alice, bob] = [newId(), newId()];
    await service.notify([alice, bob], draft('ticket:1'), at(1));
    await service.notify([alice, bob], draft('ticket:2'), at(2));
    await service.dismiss([alice], 'ticket:1', at(3));
    const state = async (user: string) =>
      Object.fromEntries(
        (await rowsOf(user)).map((row) => [row.groupKey, row.unread]),
      );
    expect(await state(alice)).toEqual({ 'ticket:1': false, 'ticket:2': true });
    expect(await state(bob)).toEqual({ 'ticket:1': true, 'ticket:2': true });
  });

  it('never moves a row back in time when a late writer holds an older clock', async () => {
    const user = newId();
    await service.notify([user], draft('a'), at(30));
    await service.notify([user], draft('a', { title: 'late' }), at(5));
    const [row] = await rowsOf(user);
    expect(row).toMatchObject({ title: 'late', count: 2 });
    expect(row.lastActivityAt).toEqual(at(30));
    expect(row.expiresAt).toEqual(notificationExpiry(at(30)));
  });

  it('opens a fresh unread row when the racing row is read before the retry', async () => {
    const user = newId();
    const create = rows.create.bind(rows) as (doc: unknown) => Promise<unknown>;
    jest.spyOn(rows, 'create').mockImplementationOnce(((
      doc: Record<string, unknown>,
    ) =>
      create({ ...doc, _id: newId() })
        .then(() => create(doc))
        .catch(async (error: unknown) => {
          await rows.updateOne({ user }, { $set: { unread: false } });
          throw error;
        })) as never);
    await service.notify([user], draft('a'), at(1));
    jest.restoreAllMocks();
    const stored = await rowsOf(user);
    expect(stored.map((row) => row.unread).sort()).toEqual([false, true]);
  });
});
