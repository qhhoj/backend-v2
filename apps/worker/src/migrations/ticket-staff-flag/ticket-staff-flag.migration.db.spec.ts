import { UUID } from 'mongodb';
import type { Document } from 'mongodb';
import { Ticket } from '@libs/database';
import { setupMigrationsTest } from '../../../test/migrations-setup';
import type { MigrationsTest } from '../../../test/migrations-setup';
import { TicketStaffFlagMigration } from './ticket-staff-flag.migration';

/** `AWAITING_STAFF` as the tickets repository reads it today, and as L24 may write it. */
const AWAITING_STAFF = {
  isOpen: true,
  lastMessageByStaff: { $in: [false, null] },
};
const AWAITING_STAFF_STRICT = { isOpen: true, lastMessageByStaff: false };

describe('ticket staff flag migration', () => {
  let test: MigrationsTest;

  beforeAll(async () => {
    test = await setupMigrationsTest();
  });
  afterAll(() => test.teardown());

  const ticket = (title: string, fields: Document = {}): Document => ({
    _id: new UUID(),
    title,
    isOpen: true,
    updatedAt: new Date('2020-01-01T00:00:00Z'),
    ...fields,
  });
  const titlesMatching = async (filter: Document) =>
    (
      await test
        .model(Ticket.name)
        .collection.find(filter)
        .sort({ _id: 1 })
        .toArray()
    ).map((row) => row.title as string);

  it('stores "not by staff" on tickets without the flag, keeps a stored flag, counts the same tickets as waiting, and a second run changes nothing', async () => {
    const legacy = [
      ticket('migrated'),
      ticket('closed-migrated', { isOpen: false }),
      ticket('null-flag', { lastMessageByStaff: null }),
    ];
    const current = [
      ticket('answered', { lastMessageByStaff: true }),
      ticket('asked', { lastMessageByStaff: false }),
    ];
    await test
      .model(Ticket.name)
      .collection.insertMany([...legacy, ...current]);
    const stored = await test.stored(Ticket.name);
    const waiting = await titlesMatching(AWAITING_STAFF);
    const migration = test.module.get(TicketStaffFlagMigration);

    expect(await migration.run()).toBe(legacy.length);

    const legacyIds = new Set(legacy.map((row) => String(row._id)));
    expect(await test.stored(Ticket.name)).toEqual(
      stored.map((row) =>
        legacyIds.has(String(row._id))
          ? { ...row, lastMessageByStaff: false }
          : row,
      ),
    );
    expect(await titlesMatching(AWAITING_STAFF)).toEqual(waiting);
    expect(await titlesMatching(AWAITING_STAFF_STRICT)).toEqual(waiting);
    expect([...waiting].sort()).toEqual(['asked', 'migrated', 'null-flag']);

    const after = await test.stored(Ticket.name);
    expect(await migration.run()).toBe(0);
    expect(await test.stored(Ticket.name)).toEqual(after);
  });
});
