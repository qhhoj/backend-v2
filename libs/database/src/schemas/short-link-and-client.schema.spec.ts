import mongoose from 'mongoose';
import type { MongoMemoryReplSet } from 'mongodb-memory-server';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { IntegrationClientSchema } from './integration-client.schema';
import { ShortLinkSchema } from './short-link.schema';

describe('short link and integration client schemas', () => {
  let replSet: MongoMemoryReplSet;
  const Links = mongoose.model('ShortLinkSpec', ShortLinkSchema);
  const Clients = mongoose.model(
    'IntegrationClientSpec',
    IntegrationClientSchema,
  );
  const link = (extra: Record<string, unknown> = {}) => ({
    code: Math.random().toString(36).slice(2, 8),
    path: '/problems/sum',
    createdBy: newId(),
    ...extra,
  });
  const client = (extra: Record<string, unknown> = {}) => ({
    name: 'Judge bridge',
    keyHash: 'a'.repeat(64),
    keyPrefix: 'qhi_abcd',
    scopes: ['contests:read'],
    allowedCidrs: ['10.0.0.0/8'],
    actsAs: newId(),
    createdBy: newId(),
    ...extra,
  });

  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Promise.all([Links, Clients].map((model) => model.syncIndexes()));
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  it('keeps codes unique', async () => {
    const first = await Links.create(link());
    await expect(
      Links.create(link({ code: first.code, path: '/blog/x' })),
    ).rejects.toThrow(/duplicate key/);
  });

  it('allows one automatic link per path but any number of staff links to it', async () => {
    const path = '/contests/oneauto';
    await Links.create(link({ path, isAuto: true }));
    await expect(Links.create(link({ path, isAuto: true }))).rejects.toThrow(
      /duplicate key/,
    );
    await expect(
      Links.create(link({ path, isAuto: false })),
    ).resolves.toBeDefined();
    await expect(
      Links.create(link({ path, isAuto: false })),
    ).resolves.toBeDefined();
  });

  it('starts a link with no hits, no expiry and no visit', async () => {
    const created = await Links.create(link({ path: '/problems/fresh' }));
    expect(created).toMatchObject({
      hits: 0,
      expiresAt: null,
      lastHitAt: null,
      isAuto: true,
    });
  });

  it('keeps key hashes unique, refuses unknown scopes and a malformed hash', async () => {
    const created = await Clients.create(client({ keyHash: 'b'.repeat(64) }));
    await expect(
      Clients.create(client({ keyHash: created.keyHash })),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Clients.create(
        client({ keyHash: 'c'.repeat(64), scopes: ['users:write'] }),
      ),
    ).rejects.toThrow(/scopes/);
    await expect(
      Clients.create(client({ keyHash: 'not-a-hash' })),
    ).rejects.toThrow(/keyHash/);
    expect(created.revokedAt).toBeNull();
    expect(created.lastUsedAt).toBeNull();
  });
});
