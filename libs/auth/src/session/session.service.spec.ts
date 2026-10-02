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
  it('destroys one session or all of a user except the kept one', async () => {
    const [first, second, third] = await Promise.all([
      sessions.create(fresh),
      sessions.create(fresh),
      sessions.create(fresh),
    ]);
    const other = await sessions.create({ ...fresh, userId: 'user-2' });
    await sessions.destroy(first.id);
    expect(await sessions.get(first.id)).toBeNull();
    await sessions.destroyAllForUser('user-1', third.id);
    expect(await sessions.get(second.id)).toBeNull();
    expect(await sessions.get(third.id)).not.toBeNull();
    expect(await sessions.get(other.id)).not.toBeNull();
  });
});
