import { Test, TestingModule } from '@nestjs/testing';
import { ENV, REDIS, RedisModule } from '@libs/common';
import { TEST_ENV, TEST_REDIS_URL } from '@libs/common/testing';
import { SettingsService } from '@libs/settings';
import { fakeSettings } from '@libs/settings/testing';
import Redis from 'ioredis';
import { sha256 } from '../crypto';
import { SessionRecords } from './session-record';
import { SESSION_TTL_SECONDS, SessionService } from './session.service';

const DAY_MS = 24 * 60 * 60 * 1000;

const fresh = {
  userId: 'user-1',
  twoFaPassed: true,
  passwordPwned: false,
  impersonatorId: null,
};

describe('SessionService', () => {
  let testingModule: TestingModule;
  let sessions: SessionService;
  let redis: Redis;

  beforeAll(async () => {
    process.env.REDIS_URL = TEST_REDIS_URL;
    testingModule = await Test.createTestingModule({
      imports: [RedisModule],
      providers: [
        SessionService,
        {
          provide: SettingsService,
          useValue: fakeSettings({ 'auth.sessionMaxDays': 30 }),
        },
        {
          provide: ENV,
          useValue: { sessionSecret: TEST_ENV.SESSION_SECRET },
        },
      ],
    }).compile();
    sessions = testingModule.get(SessionService);
    redis = testingModule.get(REDIS);
  });
  beforeEach(() => redis.flushdb());
  afterAll(() => testingModule.close());

  it('creates a session with an unguessable id and csrf token, stored only by hash', async () => {
    const { id, session } = await sessions.create(fresh);
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await sessions.get(id)).toEqual(session);
    expect(await redis.keys('*')).not.toContainEqual(
      expect.stringContaining(id),
    );
  });
  it('only reads records written under the session secret, at the key they were written for', async () => {
    const forged = { ...fresh, csrf: 'x' };
    await redis.set(`session:${sha256('planted')}`, JSON.stringify(forged));
    expect(await sessions.get('planted')).toBeNull();
    const [first, second] = await Promise.all([
      sessions.create(fresh),
      sessions.create(fresh),
    ]);
    const [firstKey, secondKey] = await redis.smembers('user-sessions:user-1');
    const sealed = (await redis.get(firstKey)) as string;
    await redis.set(secondKey, sealed);
    await redis.set(firstKey, sealed.replace('user-1', 'user-2'));
    expect(await sessions.get(first.id)).toBeNull();
    expect(await sessions.get(second.id)).toBeNull();
    expect(await redis.exists(firstKey, secondKey)).toBe(0);
    const unsigned = await sessions.create(fresh);
    const unsignedKey = new SessionRecords(TEST_ENV.SESSION_SECRET).keyFor(
      unsigned.id,
    );
    await redis.set(unsignedKey, JSON.stringify(forged));
    expect(await sessions.get(unsigned.id)).toBeNull();
    expect(await redis.exists(unsignedKey)).toBe(0);
  });
  it('keeps the per-user index as long as its sessions and drops members that expired', async () => {
    await sessions.create(fresh);
    const [expired] = await redis.keys('session:*');
    await redis.del(expired);
    const { id } = await sessions.create(fresh);
    expect(await redis.smembers('user-sessions:user-1')).toEqual(
      await redis.keys('session:*'),
    );
    await redis.expire('user-sessions:user-1', 10);
    await sessions.get(id);
    expect(await redis.ttl('user-sessions:user-1')).toBeGreaterThan(
      SESSION_TTL_SECONDS - 5,
    );
  });
  it('slides the expiry on read', async () => {
    const { id } = await sessions.create(fresh);
    const [key] = await redis.keys('session:*');
    await redis.expire(key, 10);
    await sessions.get(id);
    expect(await redis.ttl(key)).toBeGreaterThan(SESSION_TTL_SECONDS - 5);
  });
  it('ends a session at its absolute lifetime however recently it was used', async () => {
    const { id } = await sessions.create(fresh);
    const [key] = await redis.keys('session:*');
    const sealed = (await redis.get(key)) as string;
    const stored = JSON.parse(sealed.slice(sealed.indexOf('.') + 1)) as Record<
      string,
      unknown
    >;
    const started = Date.now() - 31 * DAY_MS;
    await redis.set(
      key,
      new SessionRecords(TEST_ENV.SESSION_SECRET).seal(
        key,
        JSON.stringify({ ...stored, createdAt: started }),
      ),
    );
    expect(await sessions.get(id)).toBeNull();
    expect(await redis.exists(key)).toBe(0);
    expect(await redis.scard('user-sessions:user-1')).toBe(0);
  });
  it('updates flags and keeps the csrf token', async () => {
    const { id, session } = await sessions.create({
      ...fresh,
      twoFaPassed: false,
    });
    expect(await sessions.update(id, { twoFaPassed: true })).toEqual({
      ...session,
      twoFaPassed: true,
    });
    expect(await sessions.update('missing', { twoFaPassed: true })).toBeNull();
  });
  it('does not resurrect a revoked session on update', async () => {
    const { id } = await sessions.create(fresh);
    const [key] = await redis.keys('session:*');
    await sessions.destroy(id);
    expect(await sessions.update(id, { twoFaPassed: false })).toBeNull();
    expect(await redis.exists(key)).toBe(0);
  });
  it('destroys one session or all of a user except the kept one', async () => {
    const [first, second, third] = await Promise.all([
      sessions.create(fresh),
      sessions.create(fresh),
      sessions.create(fresh),
    ]);
    const other = await sessions.create({ ...fresh, userId: 'user-2' });
    await sessions.destroy(first.id);
    expect(await sessions.get(first.id)).toBeNull();
    expect(await redis.scard('user-sessions:user-1')).toBe(2);
    await sessions.destroyAllForUser('user-1', third.id);
    expect(await sessions.get(second.id)).toBeNull();
    expect(await sessions.get(third.id)).not.toBeNull();
    expect(await sessions.get(other.id)).not.toBeNull();
    expect(await redis.scard('user-sessions:user-1')).toBe(1);
    expect(await redis.scard('user-sessions:user-2')).toBe(1);
  });
  it('keeps a field set to null as null through update', async () => {
    const { id } = await sessions.create(fresh);
    await sessions.update(id, { webauthnChallenge: 'abc' });
    const cleared = await sessions.update(id, { webauthnChallenge: null });
    expect(cleared?.webauthnChallenge).toBeNull();
    expect((await sessions.get(id))?.webauthnChallenge).toBeNull();
    const [key] = await redis.keys('session:*');
    const sealed = (await redis.get(key)) as string;
    expect(JSON.parse(sealed.slice(sealed.indexOf('.') + 1))).toMatchObject({
      webauthnChallenge: null,
      impersonatorId: null,
    });
  });
  it('consumes a single-use field exactly once, even concurrently', async () => {
    const { id } = await sessions.create(fresh);
    await sessions.update(id, { pendingTotpSecret: 'secret' });
    const results = await Promise.all([
      sessions.consume(id, 'pendingTotpSecret'),
      sessions.consume(id, 'pendingTotpSecret'),
      sessions.consume(id, 'pendingTotpSecret'),
    ]);
    expect(results.filter((value) => value === 'secret')).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(2);
    expect((await sessions.get(id))?.pendingTotpSecret).toBeNull();
    expect(await sessions.consume('missing', 'webauthnChallenge')).toBeNull();
  });
  it('does not lose concurrent updates of different fields', async () => {
    for (let round = 0; round < 20; round++) {
      const { id } = await sessions.create({ ...fresh, twoFaPassed: false });
      await Promise.all([
        sessions.update(id, { twoFaPassed: true }),
        sessions.update(id, { cookieIssuedAt: 42 }),
      ]);
      expect(await sessions.get(id)).toMatchObject({
        twoFaPassed: true,
        cookieIssuedAt: 42,
      });
    }
  });
});
