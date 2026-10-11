import { Test, TestingModule } from '@nestjs/testing';
import { REDIS, RedisModule } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import Redis from 'ioredis';
import { SESSION_TTL_SECONDS, SessionService } from './session.service';

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
      providers: [SessionService],
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
    expect(await redis.ttl('user-sessions:user-1')).toBe(-1);
  });
  it('slides the expiry on read', async () => {
    const { id } = await sessions.create(fresh);
    const [key] = await redis.keys('session:*');
    await redis.expire(key, 10);
    await sessions.get(id);
    expect(await redis.ttl(key)).toBeGreaterThan(SESSION_TTL_SECONDS - 5);
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
    expect(JSON.parse((await redis.get(key)) as string)).toMatchObject({
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
