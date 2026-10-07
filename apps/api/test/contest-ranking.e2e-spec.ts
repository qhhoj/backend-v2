import { getConnectionToken } from '@nestjs/mongoose';
import type Redis from 'ioredis';
import type { Connection } from 'mongoose';
import type { UUID } from 'mongodb';
import { REDIS } from '@libs/common';
import { rankingCacheKeys } from '@libs/contests';
import { newId, toUuid } from '@libs/database';
import type { ContestParticipation, User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { RankingResponse } from '../src/modules/contests/dto/ranking.response';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest ranking', () => {
  let api: ApiTest;
  let redis: Redis;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Array<{ _id: string }> = [];
  const results = (
    score: number,
    extra: Partial<ContestParticipation> = {},
  ): Partial<ContestParticipation> => ({
    score,
    cumtime: 0,
    tiebreaker: 0,
    frozenScore: score,
    frozenCumtime: 0,
    frozenTiebreaker: 0,
    formatData: {},
    frozenFormatData: {},
    ...extra,
  });
  const ranking = async (key: string, who?: string, query = '') => {
    const request = api.http().get(contestUrl(key, `/ranking${query}`));
    return dataOf<RankingResponse>(
      await (who ? authed(request, sessions[who]) : request).expect(200),
    );
  };
  const namesOf = (board: RankingResponse) =>
    board.rows.map((row) => row.user.username);

  beforeAll(async () => {
    api = await setupApiTest();
    redis = api.app.get<Redis>(REDIS);
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['bob', {}],
      ['carol', {}],
      ['dan', {}],
      ['erin', {}],
      ['author', { permissions: ['judge.edit_own_contest'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.push(
      await createProblem(api, catalog, { code: 'rank_a' }),
      await createProblem(api, catalog, { code: 'rank_b' }),
    );
  });
  afterAll(() => api.teardown());

  it('orders by score, cumtime and tiebreaker with shared ranks, disqualified last, virtual rows on request, spectators never', async () => {
    const contest = await createContest(api, {
      labelStyle: 'alpha',
      problems: [
        contestProblem(problems[0]._id, 0),
        contestProblem(problems[1]._id, 1),
      ],
    });
    const cell = (time: number) => ({
      [problems[0]._id]: { time, points: 100 },
    });
    const alice = await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      results(200, { cumtime: 50, formatData: cell(50) }),
    );
    await joinParticipation(
      api,
      contest._id,
      users.bob._id,
      results(200, { cumtime: 50 }),
    );
    await joinParticipation(
      api,
      contest._id,
      users.carol._id,
      results(300, { formatData: cell(100) }),
    );
    await joinParticipation(
      api,
      contest._id,
      users.dan._id,
      results(-9999, { isDisqualified: true }),
    );
    await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      results(400, { virtual: 1, formatData: cell(10) }),
    );
    await joinParticipation(
      api,
      contest._id,
      users.erin._id,
      results(500, { virtual: -1 }),
    );
    const live = await ranking(contest.key);
    expect(namesOf(live)).toEqual([
      'carol',
      expect.stringMatching(/alice|bob/),
      expect.stringMatching(/alice|bob/),
      'dan',
    ]);
    expect(live.rows.map((row) => row.rank)).toEqual([1, 2, 2, 4]);
    expect(
      live.problems.map((problem) => [problem.label, problem.code]),
    ).toEqual([
      ['A', 'rank_a'],
      ['B', 'rank_b'],
    ]);
    // The virtual row solved first, but only live rows earn a first solve.
    expect(live.problems[0]).toMatchObject({
      firstSolve: alice._id,
      acceptedCount: 2,
    });
    const withVirtual = await ranking(contest.key, undefined, '?virtual=true');
    expect(namesOf(withVirtual)).toHaveLength(5);
    expect(withVirtual.rows[0]).toMatchObject({ virtual: 1, score: 400 });
    // The virtual row (time 10) is counted but never credited with the first solve.
    expect(withVirtual.problems[0]).toMatchObject({
      firstSolve: alice._id,
      acceptedCount: 3,
    });
    expect(namesOf(withVirtual)).not.toContain('erin');
  });

  it('shows non-editors only frozen values while frozen, editors the live ones, from separate cache keys', async () => {
    const contest = await createContest(api, {
      formatName: 'icpc',
      frozenLastMinutes: 180,
      scoreboardCacheTimeout: 60,
      authors: [users.author._id],
      problems: [contestProblem(problems[0]._id, 0)],
    });
    await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      results(300, {
        frozenScore: 100,
        cumtime: 12345.5,
        formatData: {
          [problems[0]._id]: { points: 300, time: 12345.5, tries: 1 },
        },
        frozenFormatData: {
          [problems[0]._id]: { points: 0, time: null, tries: 2, pending: true },
        },
      }),
    );
    const outsider = await ranking(contest.key);
    expect(outsider.frozen).toBe(true);
    expect(outsider.rows[0]).toMatchObject({
      score: 100,
      cumtime: 0,
      cells: {
        [problems[0]._id]: { points: 0, time: null, tries: 2, pending: true },
      },
    });
    expect(JSON.stringify(outsider)).not.toContain('12345.5');
    const editor = await ranking(contest.key, 'author');
    expect(editor).toMatchObject({
      frozen: false,
      rows: [{ score: 300, cumtime: 12345.5 }],
    });
    expect(JSON.stringify(await ranking(contest.key, 'bob'))).not.toContain(
      '12345.5',
    );
    const [liveOpen, liveFrozen] = [
      rankingCacheKeys(contest._id)[0],
      rankingCacheKeys(contest._id)[1],
    ];
    expect(await redis.exists(liveOpen)).toBe(0);
    expect(await redis.exists(liveFrozen)).toBe(1);
  });

  it('shows a contestant of a hidden board only their own row, others nothing, editors everything', async () => {
    const contest = await createContest(api, {
      scoreboardVisibility: 'H',
      authors: [users.author._id],
    });
    const own = await joinParticipation(
      api,
      contest._id,
      users.carol._id,
      results(10),
    );
    await joinParticipation(api, contest._id, users.dan._id, results(20));
    await makeCurrent(api, users.carol._id, own._id);
    const mine = await ranking(contest.key, 'carol');
    expect(mine.rows).toEqual([
      expect.objectContaining({
        rank: null,
        participationId: own._id,
        score: 10,
      }),
    ]);
    await authed(
      api.http().get(contestUrl(contest.key, '/ranking')),
      sessions.erin,
    ).expect(403);
    await api.http().get(contestUrl(contest.key, '/ranking')).expect(403);
    expect(namesOf(await ranking(contest.key, 'author'))).toEqual([
      'dan',
      'carol',
    ]);
  });

  it('serves a cached board until its keys are purged, and caches nothing with a zero timeout', async () => {
    const db = api.app.get<Connection>(getConnectionToken()).db!;
    const cached = await createContest(api, { scoreboardCacheTimeout: 60 });
    const row = await joinParticipation(
      api,
      cached._id,
      users.alice._id,
      results(100),
    );
    expect((await ranking(cached.key)).rows[0].score).toBe(100);
    await api.participations.updateOne(
      { _id: row._id },
      { score: 500, frozenScore: 500 },
    );
    const operations = await profileQueries(db, () => ranking(cached.key));
    expect(
      operations.filter(
        ({ collection }) => collection === 'contestParticipations',
      ),
    ).toEqual([]);
    expect((await ranking(cached.key)).rows[0].score).toBe(100);
    await redis.del(...rankingCacheKeys(cached._id));
    expect((await ranking(cached.key)).rows[0].score).toBe(500);
    const uncached = await createContest(api);
    await ranking(uncached.key);
    expect(await redis.exists(...rankingCacheKeys(uncached._id))).toBe(0);
  });

  it("ranks 12k participations from one contest's rows and serves the next request from Redis", async () => {
    const db = api.app.get<Connection>(getConnectionToken()).db!;
    const big = await createContest(api, { scoreboardCacheTimeout: 60 });
    const other = await createContest(api);
    const insert = (contestId: string, count: number) =>
      db.collection<{ _id: UUID }>('contestParticipations').insertMany(
        Array.from({ length: count }, (_unused, index) => ({
          _id: toUuid(newId()),
          contest: toUuid(contestId),
          user: toUuid(newId()),
          realStart: new Date(),
          virtual: 0,
          score: index % 1000,
          cumtime: index,
          tiebreaker: 0,
          frozenScore: 0,
          frozenCumtime: 0,
          frozenTiebreaker: 0,
          formatData: {},
          frozenFormatData: {},
          isDisqualified: false,
          isRegistered: false,
        })),
      );
    await insert(big._id, 12_000);
    await insert(other._id, 3_000);
    let board: RankingResponse | undefined;
    const first = await profileQueries(db, async () => {
      board = await ranking(big.key);
    });
    const reads = first.filter(
      ({ collection }) => collection === 'contestParticipations',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    expect(
      reads.reduce((sum, { docsExamined }) => sum + docsExamined, 0),
    ).toBeLessThanOrEqual(12_000);
    expect(board!.rows).toHaveLength(12_000);
    expect(board!.rows[0]).toMatchObject({ rank: 1, score: 999, cumtime: 999 });
    expect(board!.rows.at(-1)).toMatchObject({ score: 0 });
    const second = await profileQueries(db, () => ranking(big.key));
    expect(
      second.filter(({ collection }) => collection === 'contestParticipations'),
    ).toEqual([]);
  });

  it('leaks no live score, cumtime or cell to a non-editor during a freeze, through ?virtual or an own-row board', async () => {
    const liveCell = {
      [problems[0]._id]: { points: 100, time: 777.25, tries: 1 },
    };
    const frozenCell = {
      [problems[0]._id]: { points: 0, time: null, tries: 1, pending: true },
    };
    const frozenResults = (score: number, cumtime: number, virtual: number) =>
      results(score, {
        cumtime,
        tiebreaker: 31337,
        frozenScore: 1,
        frozenCumtime: 0,
        frozenTiebreaker: 0,
        formatData: liveCell,
        frozenFormatData: frozenCell,
        virtual,
      });
    const open = await createContest(api, {
      formatName: 'icpc',
      frozenLastMinutes: 180,
      scoreboardCacheTimeout: 60,
      problems: [contestProblem(problems[0]._id, 0)],
    });
    await joinParticipation(
      api,
      open._id,
      users.alice._id,
      frozenResults(900, 777.25, 0),
    );
    await joinParticipation(
      api,
      open._id,
      users.alice._id,
      frozenResults(901, 777.25, 1),
    );
    for (const who of [undefined, 'bob']) {
      for (const query of ['', '?virtual=true']) {
        const board = await ranking(open.key, who, query);
        expect(board.frozen).toBe(true);
        const text = JSON.stringify(board);
        for (const leak of ['777.25', '31337', '900', '901'])
          expect(text).not.toContain(leak);
      }
    }
    const hidden = await createContest(api, {
      scoreboardVisibility: 'H',
      formatName: 'icpc',
      frozenLastMinutes: 180,
      problems: [contestProblem(problems[0]._id, 0)],
    });
    const own = await joinParticipation(
      api,
      hidden._id,
      users.carol._id,
      frozenResults(900, 777.25, 0),
    );
    await makeCurrent(api, users.carol._id, own._id);
    const mine = await ranking(hidden.key, 'carol', '?virtual=true');
    expect(mine).toMatchObject({
      frozen: true,
      rows: [{ score: 1, cumtime: 0, tiebreaker: 0, cells: frozenCell }],
    });
    expect(JSON.stringify(mine)).not.toMatch(/777\.25|31337|900/);
  });

  it('keeps the freeze after the contest ended', async () => {
    const ended = await createContest(api, {
      formatName: 'icpc',
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      frozenLastMinutes: 120,
      problems: [contestProblem(problems[0]._id, 0)],
    });
    await joinParticipation(
      api,
      ended._id,
      users.alice._id,
      results(300, { frozenScore: 100, cumtime: 4242 }),
    );
    const board = await ranking(ended.key);
    expect(board).toMatchObject({ frozen: true, rows: [{ score: 100 }] });
    expect(JSON.stringify(board)).not.toContain('4242');
    expect((await ranking(ended.key, 'author')).rows).toHaveLength(1);
  });

  it('orders rows that tie on every key the same way on each request', async () => {
    const contest = await createContest(api);
    for (const name of ['alice', 'bob', 'carol', 'dan'])
      await joinParticipation(api, contest._id, users[name]._id, results(100));
    const first = namesOf(await ranking(contest.key));
    expect(first).toHaveLength(4);
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect(namesOf(await ranking(contest.key))).toEqual(first);
    expect((await ranking(contest.key)).rows.map((row) => row.rank)).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it('never serves a live-only board to ?virtual=true or the reverse, whichever is cached first', async () => {
    const contest = await createContest(api, { scoreboardCacheTimeout: 60 });
    await joinParticipation(api, contest._id, users.alice._id, results(100));
    await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      results(200, { virtual: 1 }),
    );
    const sizes = async (queries: string[]) => {
      const lengths: number[] = [];
      for (const query of queries)
        lengths.push(
          (await ranking(contest.key, undefined, query)).rows.length,
        );
      return lengths;
    };
    expect(await sizes(['', '?virtual=true'])).toEqual([1, 2]);
    await redis.del(...rankingCacheKeys(contest._id));
    expect(await sizes(['?virtual=true', ''])).toEqual([2, 1]);
    expect(await redis.exists(...rankingCacheKeys(contest._id))).toBe(2);
  });

  it('builds a missed board once for concurrent requests', async () => {
    const db = api.app.get<Connection>(getConnectionToken()).db!;
    const contest = await createContest(api, { scoreboardCacheTimeout: 60 });
    await joinParticipation(api, contest._id, users.alice._id, results(100));
    const queries = await profileQueries(db, () =>
      Promise.all(Array.from({ length: 8 }, () => ranking(contest.key))),
    );
    expect(
      queries.filter(
        ({ collection }) => collection === 'contestParticipations',
      ),
    ).toHaveLength(1);
  });

  it('orders tied rows by participation id whatever the insertion order', async () => {
    const contest = await createContest(api);
    const ids = [
      '00000000-0000-4000-8000-000000000003',
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ];
    for (const [index, id] of ids.entries())
      await joinParticipation(
        api,
        contest._id,
        users[['alice', 'bob', 'carol'][index]]._id,
        { ...results(100), _id: id },
      );
    expect(
      (await ranking(contest.key)).rows.map((row) => row.participationId),
    ).toEqual([...ids].sort());
  });

  it('keeps concurrent cache misses of the live and the virtual board apart', async () => {
    const contest = await createContest(api, { scoreboardCacheTimeout: 60 });
    await joinParticipation(api, contest._id, users.alice._id, results(100));
    await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      results(200, { virtual: 1 }),
    );
    const [plain, withVirtual] = await Promise.all([
      ranking(contest.key),
      ranking(contest.key, undefined, '?virtual=true'),
    ]);
    expect([plain.rows.length, withVirtual.rows.length]).toEqual([1, 2]);
  });

  it('drops the cached boards when an editor updates the contest', async () => {
    const contest = await createContest(api, {
      scoreboardCacheTimeout: 60,
      authors: [users.author._id],
    });
    const row = await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      results(100),
    );
    expect((await ranking(contest.key)).rows[0].score).toBe(100);
    await api.participations.updateOne(
      { _id: row._id },
      { score: 500, frozenScore: 500 },
    );
    expect((await ranking(contest.key)).rows[0].score).toBe(100);
    await authed(api.http().patch(contestUrl(contest.key)), sessions.author)
      .send({ scoreboardCacheTimeout: 30 })
      .expect(200);
    expect((await ranking(contest.key)).rows[0].score).toBe(500);
  });
});
