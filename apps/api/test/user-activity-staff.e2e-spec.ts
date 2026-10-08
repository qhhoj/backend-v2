import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { newId } from '@libs/database';
import type { User, UserActivity } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { Logger } from '@nestjs/common';
import { ActivityLogsRepository } from '../src/modules/user-activity/staff/activity-logs.repository';
import type {
  ActivityLogResponse,
  ActivitySummaryResponse,
  LiveActivityResponse,
} from '../src/modules/user-activity/staff/dto/activity.response';
import { UserActivityCaptureService } from '../src/modules/user-activity/capture/user-activity-capture.service';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const BASE = '/api/internal/admin/user-activity';
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe('user activity staff API', () => {
  let api: ApiTest;
  let staff: TestSession;
  let plain: TestSession;
  const ids: Record<string, string> = {};
  const get = (path: string) => authed(api.http().get(`${BASE}${path}`), staff);
  const row = (who: string | null, extra: Partial<UserActivity> = {}) =>
    api.userActivities.create({
      userId: who ? ids[who] : null,
      sessionKey: `session-${who ?? 'anon'}`,
      path: '/api/internal/problems',
      method: 'GET',
      ip: '10.0.0.1',
      userAgent: 'UA',
      referer: '',
      statusCode: 200,
      at: daysAgo(0.1),
      ...extra,
    });
  const pagesOf = async (query: string) =>
    dataOf<ActivityLogResponse[]>(await get(`/logs${query}`).expect(200));

  beforeAll(async () => {
    api = await setupApiTest();
    const members: Array<[string, Partial<User>]> = [
      ['staff', { permissions: ['judge.can_see_user_activity'] }],
      ['plain', {}],
      ['alice', {}],
      ['bob', {}],
    ];
    for (const [name, extra] of members) {
      ids[name] = (await createUserWith(api, name, extra))._id;
    }
    staff = await loginAs(api, ids.staff);
    plain = await loginAs(api, ids.plain);
  });
  beforeEach(async () => {
    await Promise.all([
      api.userActivities.deleteMany({}),
      api.userSessions.deleteMany({}),
    ]);
  });
  afterAll(() => api.teardown());

  it('needs can_see_user_activity on every route', async () => {
    for (const path of [
      '/logs',
      '/logs/export',
      '/users/alice/logs',
      '/users/alice/summary',
      '/live',
    ]) {
      await api.http().get(`${BASE}${path}`).expect(401);
      await authed(api.http().get(`${BASE}${path}`), plain)
        .expect(403)
        .expect(errorCode('forbidden'));
    }
    await api.http().delete(`${BASE}/users/alice`).expect(401);
    await api.http().delete(`${BASE}/anonymous`).expect(401);
    await authed(api.http().delete(`${BASE}/users/alice`), plain).expect(403);
    await authed(api.http().delete(`${BASE}/anonymous`), plain).expect(403);
  });

  it('lists newest first and filters by window, user, anonymous, ip prefix and path', async () => {
    await row('alice', {
      path: '/api/internal/problems/a',
      at: daysAgo(0.3),
      ip: '10.0.0.1',
    });
    await row('alice', {
      path: '/api/internal/blog',
      at: daysAgo(0.2),
      ip: '10.0.0.1',
    });
    await row('alice', { path: '/old', at: daysAgo(10) });
    await row('bob', { at: daysAgo(0.1), ip: '192.168.0.9' });
    await row(null, { at: daysAgo(0.05), ip: '10.0.9.9' });
    expect((await pagesOf('')).map((log) => log.path)).toHaveLength(4);
    expect((await pagesOf('')).map((log) => log.username)).toEqual([
      null,
      'bob',
      'alice',
      'alice',
    ]);
    expect(await pagesOf('?days=30')).toHaveLength(5);
    expect((await pagesOf('?user=ALI')).map((log) => log.username)).toEqual([
      'alice',
      'alice',
    ]);
    expect(
      (await pagesOf('?user=anonymous')).map((log) => log.username),
    ).toEqual([null]);
    expect(await pagesOf('?user=nobody')).toEqual([]);
    expect((await pagesOf('?ip=10.0.')).map((log) => log.ip).sort()).toEqual([
      '10.0.0.1',
      '10.0.0.1',
      '10.0.9.9',
    ]);
    expect(
      (await pagesOf('?path=problems/a')).map((log) => log.username),
    ).toEqual(['alice']);
    await get('/logs?days=91').expect(400);
  });

  it('pages 50 rows with hasMore and no total', async () => {
    await api.userActivities.insertMany(
      Array.from({ length: 55 }, (_value, index) => ({
        _id: newId(),
        userId: ids.bob,
        sessionKey: 's',
        path: `/p${index}`,
        method: 'GET',
        ip: '1.1.1.1',
        userAgent: '',
        referer: '',
        statusCode: 200,
        at: daysAgo(0.001 * (index + 1)),
      })),
    );
    const first = (await get('/logs').expect(200)).body as {
      data: unknown[];
      meta: Record<string, unknown>;
    };
    const second = (await get('/logs?page=2').expect(200)).body as {
      data: unknown[];
      meta: Record<string, unknown>;
    };
    expect(first.data).toHaveLength(50);
    expect(first.meta).toEqual({ page: 1, pageSize: 50, hasMore: true });
    expect(second.data).toHaveLength(5);
    expect(second.meta).toEqual({ page: 2, pageSize: 50, hasMore: false });
  });

  it("shows one user's logs and a summary of their last days", async () => {
    await row('alice', { path: '/a', at: daysAgo(1), ip: '10.0.0.1' });
    await row('alice', { path: '/a', at: daysAgo(1), ip: '10.0.0.2' });
    await row('alice', { path: '/b', at: daysAgo(2), ip: '10.0.0.1' });
    await row('bob', { path: '/c' });
    await api.userSessions.create({
      sessionKey: 'k1',
      userId: ids.alice,
      ip: '10.0.0.1',
      userAgent: 'UA',
      deviceType: 'desktop',
      browser: 'Chrome',
      os: 'Linux',
      lastActivityAt: daysAgo(1),
    });
    expect((await pagesOnUser('alice')).map((log) => log.path)).toEqual([
      '/a',
      '/a',
      '/b',
    ]);
    const summary = dataOf<ActivitySummaryResponse>(
      await get('/users/alice/summary?days=30').expect(200),
    );
    expect(summary).toMatchObject({ username: 'alice', total: 3 });
    expect(summary.topPaths).toEqual([
      { value: '/a', count: 2 },
      { value: '/b', count: 1 },
    ]);
    expect(summary.topIps[0]).toEqual({ value: '10.0.0.1', count: 2 });
    expect(summary.daily.map((entry) => entry.count)).toEqual([1, 2]);
    expect(summary.daily[0].day < summary.daily[1].day).toBe(true);
    expect(summary.sessions).toEqual([
      expect.objectContaining({
        browser: 'Chrome',
        os: 'Linux',
        deviceType: 'desktop',
      }),
    ]);
    await get('/users/nobody/summary').expect(404);
    await get('/users/nobody/logs').expect(404);
  });

  it('neutralises spreadsheet formulas and quotes in the CSV export', async () => {
    await row('alice', {
      userAgent: '=HYPERLINK("http://evil")',
      referer: '+1+1',
      path: '/x,y',
    });
    const response = await get('/logs/export').expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    const lines = response.text.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe(
      'Timestamp,User,IP Address,Path,Method,Response Code,User Agent,Referer',
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain("'+1+1");
    expect(lines[1]).toContain('"/x,y"');
    expect(lines[1]).toContain(',alice,');
  });

  it('exports with the same filters and only the header when nothing matches', async () => {
    await row('alice');
    await row('bob');
    expect(
      (await get('/logs/export?user=alice').expect(200)).text
        .split('\r\n')
        .filter(Boolean),
    ).toHaveLength(2);
    expect(
      (await get('/logs/export?user=nobody').expect(200)).text
        .split('\r\n')
        .filter(Boolean),
    ).toHaveLength(1);
  });

  it("deletes one user's rows and sessions, or the anonymous ones, and nothing else", async () => {
    await row('alice');
    await row('bob');
    await row(null);
    await api.userSessions.create([
      {
        sessionKey: 'a',
        userId: ids.alice,
        ip: '1.1.1.1',
        lastActivityAt: new Date(),
      },
      {
        sessionKey: 'b',
        userId: ids.bob,
        ip: '1.1.1.1',
        lastActivityAt: new Date(),
      },
      {
        sessionKey: 'c',
        userId: null,
        ip: '1.1.1.1',
        lastActivityAt: new Date(),
      },
    ]);
    await authed(api.http().delete(`${BASE}/users/alice`), staff).expect(204);
    expect(await api.userActivities.countDocuments()).toBe(2);
    expect(
      (await api.userSessions.find().lean())
        .map((session) => session.sessionKey)
        .sort(),
    ).toEqual(['b', 'c']);
    await authed(api.http().delete(`${BASE}/anonymous`), staff).expect(204);
    expect(await api.userActivities.countDocuments()).toBe(1);
    expect(
      (await api.userSessions.find().lean()).map(
        (session) => session.sessionKey,
      ),
    ).toEqual(['b']);
    await authed(api.http().delete(`${BASE}/users/nobody`), staff).expect(404);
  });

  it('reports the live visitors of the last 30 minutes', async () => {
    const redis = api.app.get<Redis>(REDIS);
    await redis.del('active:users', 'active:anonymous', 'active:bots');
    const now = Date.now();
    await redis.zadd(
      'active:users',
      now - 60_000,
      ids.alice,
      now - 120_000,
      ids.bob,
      now - 31 * 60_000,
      ids.staff,
    );
    await redis.zadd('active:anonymous', now, 'anon-1', now, 'anon-2');
    await redis.zadd('active:bots', now, 'bot-1');
    const live = dataOf<LiveActivityResponse>(await get('/live').expect(200));
    expect(live).toMatchObject({
      windowMinutes: 30,
      authenticatedUsers: 2,
      anonymousVisitors: 2,
      bots: 1,
    });
    expect(live.users.map((entry) => entry.user.username)).toEqual([
      'alice',
      'bob',
    ]);
  });

  it("does not record the staff API's own requests", async () => {
    const capture = api.app.get(UserActivityCaptureService);
    await capture.flush();
    await api.userActivities.deleteMany({});
    await get('/logs').expect(200);
    await capture.flush();
    expect(
      await api.userActivities.countDocuments({
        path: { $regex: '^/api/internal/admin/user-activity' },
      }),
    ).toBe(0);
  });

  it('rejects out-of-range pages and windows', async () => {
    for (const query of ['?page=0', '?page=201', '?days=0', '?days=abc'])
      await get(`/logs${query}`).expect(400);
    await get('/users/alice/logs?days=91').expect(400);
    await get('/users/alice/summary?days=0').expect(400);
    await get('/live?page=0').expect(400);
  });

  it('serves every filter from an index without sorting in memory', async () => {
    await row('alice');
    await row(null);
    const queries = [
      '',
      '?user=ali',
      '?user=anonymous',
      '?ip=10.0.',
      '?path=problems',
      '?user=ali&ip=10.0.&path=problems',
      '?page=2',
    ];
    for (const query of queries)
      for (const route of ['/logs', '/logs/export']) {
        if (route === '/logs/export' && query === '?page=2') continue;
        const operations = await profileQueries(api.db, () =>
          get(`${route}${query}`).expect(200),
        );
        const reads = operations.filter(
          ({ collection }) => collection === 'userActivity',
        );
        expect(reads.length).toBeGreaterThan(0);
        for (const read of reads) {
          expect(`${route}${query} ${read.planSummary}`).not.toContain(
            'COLLSCAN',
          );
          expect(`${route}${query} ${read.planSummary}`).toContain('IXSCAN');
          expect(`${route}${query} sorted=${read.hasSortStage}`).toContain(
            'sorted=false',
          );
        }
      }
    const reads = (
      await profileQueries(api.db, () => get('/users/alice/logs').expect(200))
    ).filter(({ collection }) => collection === 'userActivity');
    expect(
      reads.every(
        ({ planSummary, hasSortStage }) =>
          planSummary.includes('IXSCAN') && !hasSortStage,
      ),
    ).toBe(true);
  });

  it('serves the summary and the deletes from indexes', async () => {
    await row('alice');
    await api.userSessions.create({
      sessionKey: 'k',
      userId: ids.alice,
      ip: '1.1.1.1',
      lastActivityAt: new Date(),
    });
    const summaryOps = await profileQueries(api.db, () =>
      get('/users/alice/summary').expect(200),
    );
    const deleteOps = await profileQueries(api.db, async () => {
      await authed(api.http().delete(`${BASE}/users/alice`), staff).expect(204);
      await authed(api.http().delete(`${BASE}/anonymous`), staff).expect(204);
    });
    for (const operation of [...summaryOps, ...deleteOps].filter(
      ({ collection }) => ['userActivity', 'userSessions'].includes(collection),
    ))
      expect(
        `${operation.collection} ${operation.operation} ${operation.planSummary}`,
      ).not.toContain('COLLSCAN');
  });

  it('sets download headers and never builds the filename from the query', async () => {
    await row('alice');
    const response = await get(
      '/logs/export?user=../../etc/passwd%22%0d%0aX:1',
    ).expect(200);
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="user-activity.csv"',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('neutralises formulas hidden behind whitespace and control characters', async () => {
    const agents = [' =1+1', '\t=1+1', '\r=1+1', '\n+cmd', ' @SUM(A1)', '-2+3'];
    for (const [index, userAgent] of agents.entries())
      await row('alice', {
        userAgent,
        path: `/p${index}`,
        at: daysAgo(0.5 - index / 100),
      });
    const body = (await get('/logs/export').expect(200)).text;
    const cells = body
      .match(/(?:"(?:[^"]|"")*"|[^,\r\n]*)(?:,|\r\n)/g)!
      .map((cell) => cell.replace(/(,|\r\n)$/, ''));
    for (const cell of cells.filter((cell) =>
      /=1\+1|\+cmd|SUM|-2\+3/.test(cell),
    ))
      expect(cell.replace(/^"/, '').startsWith("'")).toBe(true);
    expect(
      cells.filter((cell) => /=1\+1|\+cmd|SUM|-2\+3/.test(cell)),
    ).toHaveLength(agents.length);
  });

  it('caps the export at 100000 rows, newest first', async () => {
    const now = Date.now();
    const rows = Array.from({ length: 100_001 }, (_value, index) => ({
      _id: newId(),
      userId: ids.bob,
      sessionKey: 's',
      path: `/p${index}`,
      method: 'GET',
      ip: '1.1.1.1',
      userAgent: '',
      referer: '',
      statusCode: 200,
      at: new Date(now - 60_000 - index),
    }));
    for (let start = 0; start < rows.length; start += 20_000)
      await api.userActivities.insertMany(rows.slice(start, start + 20_000));
    const lines = (await get('/logs/export').expect(200)).text
      .split('\r\n')
      .filter(Boolean);
    expect(lines).toHaveLength(100_001);
    expect(lines[1]).toContain('/p0,');
    expect(lines[100_000]).toContain('/p99999,');
  }, 120_000);

  it('audits deletions with who, whom and how many', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      await row('alice');
      await row('alice');
      await api.userSessions.create({
        sessionKey: 'k',
        userId: ids.alice,
        ip: '1.1.1.1',
        lastActivityAt: new Date(),
      });
      await authed(api.http().delete(`${BASE}/users/alice`), staff).expect(204);
      await row(null);
      await authed(api.http().delete(`${BASE}/anonymous`), staff).expect(204);
      const lines = log.mock.calls.map(([message]) => String(message));
      expect(lines).toContain(
        'staff deleted the activity of alice: 2 rows, 1 sessions',
      );
      expect(lines).toContain(
        'staff deleted the anonymous activity: 1 rows, 0 sessions',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('never deletes without a concrete owner', async () => {
    await row('alice');
    await row(null);
    await expect(
      api.app.get(ActivityLogsRepository).deleteForUser(''),
    ).rejects.toThrow();
    expect(await api.userActivities.countDocuments()).toBe(2);
  });

  it('lists only signed-in users and counts anonymous visitors and bots', async () => {
    const redis = api.app.get<Redis>(REDIS);
    await redis.del('active:users', 'active:anonymous', 'active:bots');
    await redis.zadd('active:users', Date.now(), ids.alice);
    await redis.zadd(
      'active:anonymous',
      Date.now(),
      'anon-secret-key',
      Date.now(),
      'anon-2',
    );
    await redis.zadd('active:bots', Date.now(), 'bot-secret-key');
    const response = await get('/live').expect(200);
    expect(JSON.stringify(response.body)).not.toMatch(/secret-key|anon-2/);
    expect(
      (response.body as { data: LiveActivityResponse }).data,
    ).toMatchObject({ authenticatedUsers: 1, anonymousVisitors: 2, bots: 1 });
    expect(
      dataOf<LiveActivityResponse>(await get('/live?page=2').expect(200)).users,
    ).toEqual([]);
  });

  async function pagesOnUser(username: string) {
    return dataOf<ActivityLogResponse[]>(
      await get(`/users/${username}/logs?days=30`).expect(200),
    );
  }
});
