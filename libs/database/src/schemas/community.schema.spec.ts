import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { OrganizationSchema } from './organization.schema';
import { OrganizationRequestSchema } from './organization-request.schema';

describe('Community schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Organizations = mongoose.model(
    'OrganizationSchemaSpec',
    OrganizationSchema,
  );
  const Requests = mongoose.model(
    'OrganizationRequestSchemaSpec',
    OrganizationRequestSchema,
  );

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all(
      [Organizations, Requests].map((model) => model.syncIndexes()),
    );
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps slugs unique case-insensitively and starting with a letter', async () => {
    await Organizations.create({ name: 'QH', slug: 'qhh', shortName: 'qhh' });
    await expect(
      Organizations.create({ name: 'Other', slug: 'QHH', shortName: 'QHH' }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Organizations.create({ name: 'Digit', slug: '1abc', shortName: '1abc' }),
    ).rejects.toThrow(/slug/);
    await expect(
      Organizations.create({ name: 'Space', slug: 'a b', shortName: 'a b' }),
    ).rejects.toThrow(/slug/);
  });

  it('creates unlisted, closed organizations without a slot limit by default', async () => {
    const organization = await Organizations.create({
      name: 'Defaults',
      slug: 'defaults',
      shortName: 'defaults',
    });
    expect(organization.toObject()).toMatchObject({
      isUnlisted: true,
      isOpen: false,
      slots: null,
      memberCount: 0,
      performancePoints: 0,
      adminIds: [],
    });
  });

  it('keeps one pending request per user and organization, decided ones aside', async () => {
    const fields = { organization: newId(), user: newId(), reason: 'please' };
    const first = await Requests.create(fields);
    expect(first.state).toBe('P');
    await expect(Requests.create(fields)).rejects.toThrow(/duplicate key/);
    await Requests.updateOne({ _id: first._id }, { $set: { state: 'R' } });
    await expect(Requests.create(fields)).resolves.toBeDefined();
    await expect(
      Requests.create({ ...fields, organization: newId(), state: 'X' }),
    ).rejects.toThrow(/state/);
  });

  it('bounds the reason', async () => {
    await expect(
      Requests.create({
        organization: newId(),
        user: newId(),
        reason: 'x'.repeat(4097),
      }),
    ).rejects.toThrow(/reason/);
    await expect(
      Requests.create({ organization: newId(), user: newId(), reason: '' }),
    ).rejects.toThrow(/reason/);
  });
});
