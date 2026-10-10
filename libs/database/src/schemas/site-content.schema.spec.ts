import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { FlatpageSchema } from './flatpage.schema';
import { MiscConfigSchema } from './misc-config.schema';
import { TicketSchema } from './ticket.schema';
import { UserActivitySchema } from './user-activity.schema';
import { UserSessionSchema } from './user-session.schema';

describe('site content and activity schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Flatpages = mongoose.model('FlatpageSchemaSpec', FlatpageSchema);
  const Misc = mongoose.model('MiscConfigSchemaSpec', MiscConfigSchema);
  const Tickets = mongoose.model('TicketSchemaSpec', TicketSchema);
  const Sessions = mongoose.model('UserSessionSchemaSpec', UserSessionSchema);
  const Activities = mongoose.model(
    'UserActivitySchemaSpec',
    UserActivitySchema,
  );

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Flatpages, Misc, Tickets, Sessions, Activities].map((model) =>
        model.syncIndexes(),
      ),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps flatpage urls and misc keys unique', async () => {
    await Flatpages.create({ url: '/about', title: 'About' });
    await expect(
      Flatpages.create({ url: '/about', title: 'Again' }),
    ).rejects.toThrow(/duplicate key/);
    await Misc.create({ key: 'site_name', value: 'QH' });
    await expect(Misc.create({ key: 'site_name', value: 'x' })).rejects.toThrow(
      /duplicate key/,
    );
  });

  it('refuses a ticket title over 100 characters', async () => {
    await expect(
      Tickets.create({
        title: 'x'.repeat(101),
        user: newId(),
        linkedItem: { type: 'general', id: newId() },
      }),
    ).rejects.toThrow(/title/);
  });

  it('expires sessions and activity rows after 90 days (TTL indexes, not waited for)', async () => {
    const ttlOf = async (
      model: Pick<typeof Sessions, 'collection'>,
      field: string,
    ) =>
      (await model.collection.indexes()).find(
        (index) =>
          index.key[field] === 1 && Object.keys(index.key).length === 1,
      )?.expireAfterSeconds;
    expect(await ttlOf(Activities, 'at')).toBe(7_776_000);
    expect(await ttlOf(Sessions, 'lastActivityAt')).toBe(7_776_000);
  });
});
