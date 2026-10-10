import { profileQueries } from '@libs/database/testing';
import type { StaffUserResponse } from '../src/modules/users/admin/dto/staff-user.response';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const BASE = '/api/internal/admin/users';
const STAFF_KEYS = [
  'banReason',
  'dateJoined',
  'displayName',
  'displayRank',
  'id',
  'isActive',
  'isStaff',
  'isSuperuser',
  'lastAccess',
  'rating',
  'username',
].sort();

describe('staff user list', () => {
  let api: ApiTest;
  let moderator: TestSession;
  const list = async (query = '', session = moderator) => {
    const response = await authed(
      api.http().get(`${BASE}${query}`),
      session,
    ).expect(200);
    return {
      items: dataOf<StaffUserResponse[]>(response),
      meta: (response.body as { meta: { total: number } }).meta,
    };
  };
  const names = async (query = '') =>
    (await list(query)).items.map((item) => item.username);

  beforeAll(async () => {
    api = await setupApiTest();
    moderator = await loginAs(
      api,
      (
        await createUserWith(api, 'moderator', {
          permissions: ['judge.ban_user'],
        })
      )._id,
    );
    await createUserWith(api, 'alice1', {});
    await createUserWith(api, 'alice2', {});
    await createUserWith(api, 'bob', { rating: 1777 });
    await createUserWith(api, 'mallory', {
      banReason: 'spam',
      displayRank: 'banned',
      isActive: false,
    });
  });
  afterAll(() => api.teardown());

  it('matches usernames by case-insensitive prefix, in username order', async () => {
    expect(await names('?search=ali')).toEqual(['alice1', 'alice2']);
    expect(await names('?search=ALI')).toEqual(['alice1', 'alice2']);
    expect(await names('?search=lice')).toEqual([]);
  });

  it('treats the search as literal text, never as a pattern', async () => {
    expect(await names('?search=.*')).toEqual([]);
    expect(await names('?search=a(')).toEqual([]);
    expect(await names('?search=%5E')).toEqual([]);
  });

  it('lists only banned users with their reason when banned=true', async () => {
    const { items } = await list('?banned=true');
    expect(
      items.map(({ username, banReason }) => [username, banReason]),
    ).toEqual([['mallory', 'spam']]);
  });

  it('lists only users who are not banned when banned=false', async () => {
    expect(await names('?banned=false')).toEqual([
      'bob',
      'alice2',
      'alice1',
      'moderator',
    ]);
  });

  it('combines the search with the banned filter', async () => {
    expect(await names('?search=mal&banned=true')).toEqual(['mallory']);
    expect(await names('?search=mal&banned=false')).toEqual([]);
    expect(await names('?search=ali&banned=true')).toEqual([]);
  });

  it('carries the rating, null when unrated', async () => {
    const { items } = await list('?search=bob');
    expect(items.map((item) => [item.username, item.rating])).toEqual([
      ['bob', 1777],
    ]);
    expect((await list('?search=alice1')).items[0].rating).toBeNull();
  });

  it('returns newest accounts first with the total', async () => {
    const { items, meta } = await list('?pageSize=2');
    expect(items.map((item) => item.username)).toEqual(['mallory', 'bob']);
    expect(meta).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(await names('?pageSize=2&page=3')).toEqual(['moderator']);
  });

  it('never returns an e-mail, a password hash or a second-factor secret', async () => {
    const { items } = await list('?search=mal');
    expect(Object.keys(items[0]).sort()).toEqual(STAFF_KEYS);
    expect(JSON.stringify(items)).not.toMatch(/email|password|totp|scratch/i);
  });

  it('refuses users without judge.ban_user and anonymous callers', async () => {
    const plain = await loginAs(
      api,
      (await createUserWith(api, 'plain', {}))._id,
    );
    await authed(api.http().get(BASE), plain).expect(403);
    await api.http().get(BASE).expect(401);
  });

  it('rejects a page size above 100 and a page above 500', async () => {
    await authed(api.http().get(`${BASE}?pageSize=101`), moderator).expect(400);
    await authed(api.http().get(`${BASE}?page=501`), moderator).expect(400);
  });

  /** Counts are `COUNT_SCAN` on the same key; finds are `IXSCAN`. */
  const onIndex = (key: string) =>
    new RegExp(`(IXSCAN|COUNT_SCAN) \\{ ${key}: 1 \\}`);

  it('serves each filter and order from its index', async () => {
    // The auth guard reads the session's user by _id (an EXPRESS plan) on every request; the list's own reads are not express.
    const cases: Array<{
      query: string;
      find: RegExp;
      mayUseSort: boolean;
      count: RegExp | null;
    }> = [
      {
        query: '?search=ali',
        find: /IXSCAN \{ username: 1 \}/,
        mayUseSort: false,
        count: onIndex('username'),
      },
      {
        query: '?sort=-lastAccess',
        find: /IXSCAN \{ lastAccess: 1, _id: 1 \}/,
        mayUseSort: false,
        count: null,
      },
      {
        query: '?sort=lastAccess',
        find: /IXSCAN \{ lastAccess: 1, _id: 1 \}/,
        mayUseSort: false,
        count: null,
      },
      {
        query: '?search=ALI&banned=true',
        // The planner may pick the small banned index; its sort then covers only banned users.
        find: /IXSCAN \{ (username|banReason): 1 \}/,
        mayUseSort: true,
        count: onIndex('(username|banReason)'),
      },
      {
        query: '?banned=true',
        find: /IXSCAN \{ banReason: 1 \}/,
        mayUseSort: true,
        count: onIndex('banReason'),
      },
      {
        // Not banned has no index of its own: the find walks _id, and the count is the whole collection's, as the unfiltered list's is.
        query: '?banned=false',
        find: /IXSCAN \{ _id: 1 \}/,
        mayUseSort: false,
        count: null,
      },
    ];
    for (const { query, find, mayUseSort, count } of cases) {
      const operations = await profileQueries(api.db, () =>
        authed(api.http().get(`${BASE}${query}`), moderator).expect(200),
      );
      const reads = operations.filter(
        ({ collection, planSummary }) =>
          collection === 'users' && !planSummary.startsWith('EXPRESS_'),
      );
      const finds = reads.filter(({ operation }) => operation === 'query');
      expect(finds.length).toBe(1);
      expect(`${query} ${finds[0].planSummary}`).toMatch(find);
      if (!mayUseSort) expect(finds[0].hasSortStage).toBe(false);
      if (count)
        for (const read of reads.filter(
          ({ operation }) => operation !== 'query',
        ))
          expect(`${query} ${read.planSummary}`).toMatch(count);
    }
  });

  it('sorts by last access either way, with never-seen users oldest, over a search', async () => {
    await createUserWith(api, 'seen_old', {
      lastAccess: new Date('2025-01-01T00:00:00Z'),
    });
    await createUserWith(api, 'seen_new', {
      lastAccess: new Date('2026-06-01T00:00:00Z'),
    });
    await createUserWith(api, 'seen_never', { lastAccess: null });
    expect(await names('?search=seen&sort=lastAccess')).toEqual([
      'seen_never',
      'seen_old',
      'seen_new',
    ]);
    expect(await names('?search=seen&sort=-lastAccess')).toEqual([
      'seen_new',
      'seen_old',
      'seen_never',
    ]);
    await authed(api.http().get(`${BASE}?sort=username`), moderator).expect(
      400,
    );
  });
});
