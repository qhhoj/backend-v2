import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { NotificationSchema } from './notification.schema';

describe('Notification schema', () => {
  let replSet: MongoMemoryReplSet;
  const Notifications = mongoose.model(
    'NotificationSchemaSpec',
    NotificationSchema,
  );
  const fields = (overrides: Record<string, unknown> = {}) => {
    const now = new Date();
    return {
      user: newId(),
      kind: 'ticket-message',
      title: 'Phiếu hỗ trợ có trả lời mới',
      path: '/tickets/1',
      groupKey: `group-${newId()}`,
      lastActivityAt: now,
      createdAt: now,
      expiresAt: now,
      ...overrides,
    };
  };

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Notifications.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('stores a new row as one unread normal event', async () => {
    const row = await Notifications.create(fields());
    expect(row).toMatchObject({
      count: 1,
      unread: true,
      priority: 'normal',
      body: '',
      readAt: null,
      refs: [],
    });
  });

  it('keeps one unread row per user and group, and any number of read ones', async () => {
    const first = fields();
    await Notifications.create(first);
    await expect(Notifications.create(first)).rejects.toThrow(/duplicate key/);
    await Notifications.updateOne(
      { user: first.user, groupKey: first.groupKey },
      { $set: { unread: false } },
    );
    await Notifications.create(first);
    await Notifications.updateOne(
      { user: first.user, groupKey: first.groupKey, unread: true },
      { $set: { unread: false } },
    );
    await Notifications.create(first);
    expect(
      await Notifications.countDocuments({
        user: first.user,
        groupKey: first.groupKey,
      }),
    ).toBe(3);
  });

  it('lets two users hold the same group', async () => {
    const groupKey = `shared-${newId()}`;
    await Notifications.create(fields({ groupKey }));
    await Notifications.create(fields({ groupKey }));
  });

  it('refuses a path that leaves the site', async () => {
    for (const path of [
      '//evil.com',
      'https://evil.com',
      '/\\evil',
      'tickets/1',
    ])
      await expect(Notifications.create(fields({ path }))).rejects.toThrow(
        /path/i,
      );
    await Notifications.create(fields({ path: '/contests/a_b/announcements' }));
  });
});
