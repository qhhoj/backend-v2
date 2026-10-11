import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { FlatpageSchema } from './flatpage.schema';
import { MiscConfigSchema } from './misc-config.schema';

describe('site content schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Flatpages = mongoose.model('FlatpageSchemaSpec', FlatpageSchema);
  const Misc = mongoose.model('MiscConfigSchemaSpec', MiscConfigSchema);

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all([Flatpages, Misc].map((model) => model.syncIndexes()));
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
});
