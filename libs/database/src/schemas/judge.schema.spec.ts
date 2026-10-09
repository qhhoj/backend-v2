import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { JudgeSchema } from './judge.schema';

describe('Judge schema', () => {
  let replSet: MongoMemoryReplSet;
  const Judges = mongoose.model('JudgeSchemaSpec', JudgeSchema);
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Judges.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('is offline, enabled and unblocked until the bridge says otherwise', async () => {
    const judge = await Judges.create({ name: 'judge-01', authKeyHash: 'h' });
    expect(judge.toObject()).toMatchObject({
      online: false,
      isBlocked: false,
      isDisabled: false,
      ping: null,
      load: null,
      runtimes: [],
      slots: 0,
      busy: 0,
      build: '',
      protocolMinor: 0,
      features: [],
    });
  });
  it('rejects a duplicate name and names that are not hostname-like', async () => {
    await expect(
      Judges.create({ name: 'judge-01', authKeyHash: 'h' }),
    ).rejects.toThrow(/duplicate key/);
    for (const name of ['', 'has space', 'x'.repeat(51), 'a/b'])
      await expect(Judges.create({ name, authKeyHash: 'h' })).rejects.toThrow(
        /validation failed/,
      );
  });
});
