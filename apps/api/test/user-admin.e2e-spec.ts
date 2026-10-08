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
    await createUserWith(api, 'bob', {});
    await createUserWith(api, 'mallory', {
      banReason: 'spam',
      displayRank: 'banned',
      isActive: false,
    });
  });
  afterAll(() => api.teardown());

  it('matches usernames by case-insensitive prefix', async () => {
    expect(await names('?search=ali')).toEqual(['alice2', 'alice1']);
    expect(await names('?search=ALI')).toEqual(['alice2', 'alice1']);
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

  it('combines the search with the banned filter', async () => {
    expect(await names('?search=mal&banned=true')).toEqual(['mallory']);
    expect(await names('?search=ali&banned=true')).toEqual([]);
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

  it('rejects a page size above 100', async () => {
    await authed(api.http().get(`${BASE}?pageSize=101`), moderator).expect(400);
  });

  it('serves the search and the banned filter from indexes', async () => {
    for (const query of [
      '?search=ali',
      '?search=ALI&banned=true',
      '?banned=true',
    ]) {
      const operations = await profileQueries(api.db, () =>
        authed(api.http().get(`${BASE}${query}`), moderator).expect(200),
      );
      const reads = operations.filter(
        ({ collection }) => collection === 'users',
      );
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads)
        expect(`${query} ${read.planSummary}`).toMatch(/IXSCAN|COUNT_SCAN/);
    }
  });
});
