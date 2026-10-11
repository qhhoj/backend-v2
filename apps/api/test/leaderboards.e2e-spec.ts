import type {
  LeaderboardEntryResponse,
  RankResponse,
} from '../src/modules/users/leaderboards/dto/leaderboard.response';

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
    // Legacy documents may lack the field: missing and null must tie.
    await api.users.collection.updateOne(
      { username: 'gia' },
      { $unset: { rating: '' } },
    );
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
    expect(rows[1].organization).toMatchObject({
      slug: 'listed_org',
      isOpen: true,
    });
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
    await api.http().get('/api/internal/users/zz_inactive/rank').expect(404);
    await api.http().get('/api/internal/users/nobody/rank').expect(404);
  });
});

describe('rank lookup across pages', () => {
  let api: ApiTest;

  beforeAll(async () => {
    api = await setupApiTest();
    await api.users.insertMany(
      Array.from({ length: 150 }, (_unused, index) => ({
        username: `tied${String(index).padStart(3, '0')}`,
        email: `tied${index}@example.com`,
        password: 'x',
        isActive: true,
        rating: 1000,
      })),
    );
  });
  afterAll(() => api.teardown());

  it('sends every tied user to the board page that lists them, in id order', async () => {
    const boardPage = async (page: number) =>
      dataOf<LeaderboardEntryResponse[]>(
        await api.http().get(`/api/internal/users?page=${page}`).expect(200),
      );
    const listing = [...(await boardPage(1)), ...(await boardPage(2))];
    expect(listing).toHaveLength(150);
    for (const position of [0, 49, 99, 100, 149]) {
      const response = await api
        .http()
        .get(`/api/internal/users/${listing[position].username}/rank`)
        .expect(200);
      expect(dataOf<RankResponse>(response)).toEqual({
        rank: 1,
        page: position < 100 ? 1 : 2,
        pageSize: 100,
      });
    }
  });
});
