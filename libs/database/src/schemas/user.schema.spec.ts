import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { CI } from '../schema';
import { startMongo } from '../testing';
import { newId } from '../uuid';
import { UserSchema } from './user.schema';

const UUID_PATTERN = /^[0-9a-f-]{36}$/;

describe('user schema', () => {
  let replSet: MongoMemoryReplSet;
  const Users = mongoose.model('User', UserSchema);
  const socialAuth = [
    { provider: 'google-oauth2', uid: 'g-123', extraData: {} },
  ];
  beforeAll(async () => {
    replSet = await startMongo();
    await mongoose.connect(replSet.getUri());
    await Users.syncIndexes();
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });
  beforeEach(async () => {
    await Users.deleteMany({});
  });

  it('applies profile defaults and assigns a UUID _id', async () => {
    const user = await Users.create({ username: 'alice', password: 'x' });
    const stored = await Users.collection.findOne({ username: 'alice' });
    expect(stored?._id.toString()).toMatch(UUID_PATTERN);
    expect(user.toObject()).toMatchObject({
      timezone: 'America/Toronto',
      allowTagging: true,
      aceTheme: 'auto',
      siteTheme: 'auto',
      appearance: null,
      displayRank: 'user',
      mathEngine: 'auto',
      points: 0,
      groups: [],
      badges: [],
      organizations: [],
      permissions: [],
      webauthnCredentials: [],
      socialAuth: [],
      totpKey: null,
      webauthnUserHandle: null,
    });
  });

  it('enforces case-insensitive unique usernames', async () => {
    await Users.create({ username: 'alice', password: 'x' });
    await expect(
      Users.create({ username: 'ALICE', password: 'x' }),
    ).rejects.toThrow(/duplicate key/);
    const found = await Users.findOne({ username: 'ALICE' }).collation(CI);
    expect(found?.username).toBe('alice');
  });

  it('allows duplicate emails', async () => {
    await Users.create({
      username: 'bob',
      password: 'x',
      email: 'bob@example.com',
    });
    await expect(
      Users.create({
        username: 'bob2',
        password: 'x',
        email: 'BOB@example.com',
      }),
    ).resolves.toBeDefined();
  });

  it('enforces unique socialAuth (provider, uid) across users', async () => {
    await Users.create({ username: 'one', password: 'x', socialAuth });
    await expect(
      Users.create({ username: 'two', password: 'x', socialAuth }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Users.create([
        { username: 'three', password: 'x' },
        { username: 'four', password: 'x' },
      ]),
    ).resolves.toHaveLength(2);
  });

  it('assigns a UUID _id to webauthn credentials', async () => {
    const user = await Users.create({
      username: 'carol',
      password: 'x',
      webauthnCredentials: [
        { name: 'key', credId: 'cred-id', publicKey: 'pk', counter: 0 },
      ],
    });
    expect(user.webauthnCredentials[0]._id).toMatch(UUID_PATTERN);
  });

  it('enforces unique webauthn credId across users', async () => {
    const webauthnCredentials = [
      { name: 'key', credId: 'cred-1', publicKey: 'pk', counter: 0 },
    ];
    await Users.create({ username: 'one', password: 'x', webauthnCredentials });
    await expect(
      Users.create({ username: 'two', password: 'x', webauthnCredentials }),
    ).rejects.toThrow(/duplicate key/);
    await expect(
      Users.create([
        { username: 'three', password: 'x' },
        { username: 'four', password: 'x' },
      ]),
    ).resolves.toHaveLength(2);
  });

  it('exposes id and hides _id in JSON', async () => {
    const json = (
      await Users.create({ username: 'alice', password: 'x' })
    ).toJSON();
    expect(json).toMatchObject({
      id: expect.stringMatching(UUID_PATTERN) as string,
    });
    expect(json).not.toHaveProperty('_id');
  });

  it('serializes nested UUID references as strings', async () => {
    const groupId = newId();
    const user = await Users.create({
      username: 'carol',
      password: 'x',
      groups: [groupId],
      webauthnCredentials: [
        { name: 'key', credId: 'cred-9', publicKey: 'pk', counter: 0 },
      ],
    });
    const json = JSON.parse(JSON.stringify(user.toJSON())) as {
      id: string;
      groups: string[];
      webauthnCredentials: { _id: string }[];
    };
    expect(json.groups).toEqual([groupId]);
    expect(json.webauthnCredentials[0]._id).toMatch(UUID_PATTERN);
    expect(json.id).toMatch(UUID_PATTERN);
    expect(json.webauthnCredentials[0]).not.toHaveProperty('id');
    expect(json).not.toHaveProperty('_id');
  });
});
