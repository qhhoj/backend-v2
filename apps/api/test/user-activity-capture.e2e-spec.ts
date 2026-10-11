import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { uuidStr } from '@libs/database';
import { ActiveUsersStore } from '../src/modules/user-activity/capture/active-users.store';
import { UserActivityCaptureService } from '../src/modules/user-activity/capture/user-activity-capture.service';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const GOOGLEBOT =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
/** A public page the log tracks (`/site` and `/auth/me` are excluded as SPA polls). */
const TRACKED = '/api/internal/tags/catalog';
const MINUTE = 60_000;

describe('user activity capture', () => {
  let api: ApiTest;
  let capture: UserActivityCaptureService;
  let active: ActiveUsersStore;
  let redis: Redis;
  const visit = (agent = CHROME, path = TRACKED) =>
    api.http().get(path).set('User-Agent', agent);
  const rows = () => api.userActivities.find().sort({ at: 1 }).lean();

  beforeAll(async () => {
    api = await setupApiTest();
    capture = api.app.get(UserActivityCaptureService);
    active = api.app.get(ActiveUsersStore);
    redis = api.app.get<Redis>(REDIS);
  });
  beforeEach(async () => {
    await capture.flush();
    await Promise.all([
      api.users.deleteMany({}),
      api.userActivities.deleteMany({}),
      api.userSessions.deleteMany({}),
    ]);
    const keys = [
      ...(await redis.keys('active:*')),
      ...(await redis.keys('user-access:*')),
    ];
    if (keys.length) await redis.del(...keys);
  });
  afterAll(() => api.teardown());

  it('stores no query string, cookie or raw session id', async () => {
    const user = await createUserWith(api, 'visitor');
    const session = await loginAs(api, user._id);
    await authed(
      visit()
        .query({ token: 'hunter2' })
        .set('Referer', 'https://oj.example/problems?code=abc'),
      session,
    ).expect(200);
    await capture.flush();
    const [row] = await rows();
    expect(row).toMatchObject({
      path: TRACKED,
      method: 'GET',
      statusCode: 200,
      referer: 'https://oj.example/problems',
      userAgent: CHROME,
    });
    expect(uuidStr(row.userId)).toBe(user._id);
    expect(row.sessionKey).toMatch(/^[0-9a-f]{64}$/);
    const sessionId = session.cookie.split('=')[1].split(';')[0];
    const everything = JSON.stringify([
      await rows(),
      await api.userSessions.find().lean(),
      await redis.zrange('active:users', 0, -1),
    ]);
    for (const secret of ['hunter2', 'code=abc', sessionId])
      expect(everything).not.toContain(secret);
  });

  it('upserts one session per visitor with device details', async () => {
    const user = await createUserWith(api, 'visitor');
    const session = await loginAs(api, user._id);
    await authed(visit(), session).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await authed(visit(), session).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await visit(GOOGLEBOT).expect(200);
    await capture.flush();
    const sessions = await api.userSessions
      .find()
      .sort({ lastActivityAt: 1 })
      .lean();
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'Linux',
    });
    expect(uuidStr(sessions[0].userId)).toBe(user._id);
    expect(sessions[1]).toMatchObject({ deviceType: 'bot', userId: null });
    expect(await api.userActivities.countDocuments()).toBe(3);
  });

  it('attributes impersonated requests to the impersonator and leaves the target untouched', async () => {
    const admin = await createUserWith(api, 'boss', { isSuperuser: true });
    const target = await createUserWith(api, 'target');
    const { id, session } = await api.sessions.create({
      userId: target._id,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: admin._id,
    });
    await authed(visit(), {
      cookie: `qhhoj_session=${id}`,
      csrf: session.csrf,
    }).expect(200);
    await capture.flush();
    const [row] = await rows();
    expect(uuidStr(row.userId)).toBe(admin._id);
    expect(
      (await api.users.findById(target._id).lean())!.lastAccess,
    ).toBeFalsy();
    expect(
      (await api.users.findById(admin._id).lean())!.lastAccess,
    ).toBeInstanceOf(Date);
    expect(await redis.zscore('active:users', target._id)).toBeNull();
    expect(await redis.zscore('active:users', admin._id)).not.toBeNull();
  });

  it('writes lastAccess and the ip at most once per five minutes per user', async () => {
    const user = await createUserWith(api, 'visitor');
    const session = await loginAs(api, user._id);
    await authed(visit(), session).expect(200);
    await capture.flush();
    const first = (await api.users.findById(user._id).lean())!;
    expect(first.lastAccess).toBeInstanceOf(Date);
    expect(first.ip).toBe((await rows())[0].ip);
    const guardTtl = await redis.ttl(`user-access:${user._id}`);
    expect(guardTtl).toBeGreaterThan(290);
    expect(guardTtl).toBeLessThanOrEqual(300);
    const sentinel = new Date('2020-01-01T00:00:00Z');
    await api.users.updateOne(
      { _id: user._id },
      { lastAccess: sentinel, ip: '9.9.9.9' },
    );
    await authed(visit(), session).expect(200);
    await capture.flush();
    expect((await api.users.findById(user._id).lean())!.lastAccess).toEqual(
      sentinel,
    );
    await redis.del(`user-access:${user._id}`);
    await authed(visit(), session).expect(200);
    await capture.flush();
    const third = (await api.users.findById(user._id).lean())!;
    expect(third.lastAccess!.getTime()).toBeGreaterThan(sentinel.getTime());
    expect(third.ip).not.toBe('9.9.9.9');
  });

  it('keeps the last 30 minutes of visitors live, split into users, anonymous visitors and bots', async () => {
    const user = await createUserWith(api, 'visitor');
    const session = await loginAs(api, user._id);
    await authed(visit(), session).expect(200);
    await visit('Anon agent').expect(200);
    await visit(GOOGLEBOT).expect(200);
    await capture.flush();
    await redis.zadd(
      'active:users',
      Date.now() - 31 * MINUTE,
      'a-user-seen-31-minutes-ago',
    );
    expect(await active.counts()).toEqual({
      authenticatedUsers: 1,
      anonymousVisitors: 1,
      bots: 1,
    });
    expect((await active.users(1, 50)).map((entry) => entry.userId)).toEqual([
      user._id,
    ]);
  });
});
