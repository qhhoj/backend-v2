import { profileQueries } from '@libs/database/testing';
import type { LeaderboardEntryResponse } from '../src/modules/users/leaderboards/dto/leaderboard.response';
import { createOrganization } from './organization-fixtures';
import { createUserWith } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('leaderboards', () => {
  let api: ApiTest;
  const board = async (url: string) =>
    dataOf<LeaderboardEntryResponse[]>(await api.http().get(url).expect(200));

  beforeAll(async () => {
    api = await setupApiTest();
    const listed = await createOrganization(api, { slug: 'listed_org' });
    const unlisted = await createOrganization(api, {
      slug: 'unlisted_org',
      isUnlisted: true,
    });
    const rows: Array<[string, number | null, number, number]> = [
      ['ana', 2000, 90, 7],
      ['bao', 1800, 90, 7],
      ['chi', 1800, 70, 3],
      ['dung', 1800, 60, 3],
      ['em', null, 50, 1],
      ['gia', null, 40, 0],
    ];
    for (const [
      username,
      rating,
      performancePoints,
      contributionPoints,
    ] of rows)
      await createUserWith(api, username, {
        rating,
        performancePoints,
        contributionPoints,
        problemCount: Math.round(performancePoints / 10),
        organizations: username === 'bao' ? [unlisted._id, listed._id] : [],
      });
    await createUserWith(api, 'zz_unlisted', {
      rating: 3000,
      performancePoints: 999,
      isUnlisted: true,
    });
    await createUserWith(api, 'zz_inactive', {
      rating: 3000,
      performancePoints: 999,
      isActive: false,
    });
  });
  afterAll(() => api.teardown());

  it('ranks by rating like legacy ranker, ties sharing a rank, nulls last, hidden users left out', async () => {
    expect(
      (await board('/api/internal/users')).map((row) => [
        row.username,
        row.rank,
      ]),
    ).toEqual([
      ['ana', 1],
      ['bao', 2],
      ['chi', 2],
      ['dung', 2],
      ['em', 5],
      ['gia', 5],
    ]);
  });

  it('continues ranks across pages', async () => {
    expect(
      (await board('/api/internal/users?pageSize=2&page=2')).map((row) => [
        row.username,
        row.rank,
      ]),
    ).toEqual([
      ['chi', 2],
      ['dung', 2],
    ]);
    expect(
      (await board('/api/internal/users?pageSize=2&page=3')).map((row) => [
        row.username,
        row.rank,
      ]),
    ).toEqual([
      ['em', 5],
      ['gia', 5],
    ]);
  });

  it('sorts by performance points on request and shows the first listed organization', async () => {
    const rows = await board('/api/internal/users?sort=performancePoints');
    expect(rows.map((row) => [row.username, row.rank])).toEqual([
      ['ana', 1],
      ['bao', 1],
      ['chi', 3],
      ['dung', 4],
      ['em', 5],
      ['gia', 6],
    ]);
    expect(rows[1].organization?.slug).toBe('listed_org');
    await api.http().get('/api/internal/users?sort=password').expect(400);
  });

  it('ranks contributors', async () => {
    expect(
      (await board('/api/internal/contributors')).map((row) => [
        row.username,
        row.rank,
      ]),
    ).toEqual([
      ['ana', 1],
      ['bao', 1],
      ['chi', 3],
      ['dung', 3],
      ['em', 5],
      ['gia', 6],
    ]);
  });

  it('finds a user rank and page like legacy, ties ordered by id', async () => {
    const rankOf = async (username: string, query = '') =>
      (
        await api
          .http()
          .get(`/api/internal/users/${username}/rank${query}`)
          .expect(200)
      ).body as { data: { rank: number; page: number } };
    expect((await rankOf('dung')).data).toEqual({
      rank: 2,
      page: 1,
      pageSize: 100,
    });
    expect(
      (await rankOf('gia', '?sort=contributionPoints')).data,
    ).toMatchObject({ rank: 6 });
    expect((await rankOf('em')).data).toMatchObject({ rank: 5 });
    await api.http().get('/api/internal/users/zz_unlisted/rank').expect(404);
  });

  it('reads the board through the leaderboard indexes', async () => {
    const operations = await profileQueries(api.db, () =>
      board('/api/internal/users?sort=points&pageSize=3'),
    );
    const reads = operations.filter(({ collection }) => collection === 'users');
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    expect(
      Math.max(...reads.map(({ docsExamined }) => docsExamined)),
    ).toBeLessThanOrEqual(4);
  });
});
