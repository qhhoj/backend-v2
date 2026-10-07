import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { UUID } from 'mongodb';
import { newId, toUuid } from '@libs/database';
import type { Contest } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { isoformat } from '../src/modules/api-v2/legacy-envelope';
import {
  contestProblem,
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
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

type Row = Record<string, unknown>;
type Detail = Row & { problems: unknown[]; rankings: Row[] };
type LegacyBody = {
  data: Row & { objects: Row[]; object: Detail };
  error?: { code: number; message: string };
};

describe('/api/v2 contests and participations', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  let problemId: string;
  let otherProblemId: string;
  let rated: Contest;
  let privateContest: Contest;
  let ended: Contest;
  let future: Contest;
  let frozen: Contest;
  let running: Contest;
  let hiddenBoard: Contest;
  let configured: Contest;
  let pretested: Contest;
  let unrated: Contest;
  const organizationId = newId();
  const frozenCell = { points: 100, time: 10, tries: 1 };
  const liveCell = { points: 300, time: 30, tries: 2 };
  const get = (url: string) => api.http().get(url);
  const bodyOf = async (request: ReturnType<typeof get>) =>
    (await request.expect(200)).body as LegacyBody;

  beforeAll(async () => {
    api = await setupApiTest();
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Record<string, unknown>]> = [
      ['alice', {}],
      ['bob', {}],
      ['viewer', {}],
      ['editor', { permissions: ['judge.edit_own_contest'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problemId = (await createProblem(api, catalog, { code: 'one' }))._id;
    otherProblemId = (await createProblem(api, catalog, { code: 'two' }))._id;
    const entry = [contestProblem(problemId, 0)];

    rated = await createContest(api, {
      isRated: true,
      rateAll: true,
      tags: ['dp'],
      timeLimit: 7200,
    });
    await createContest(api, { tags: ['greedy'] });
    privateContest = await createContest(api, { isPrivate: true });
    future = await createContest(api, {
      startTime: hoursFromNow(5),
      endTime: hoursFromNow(8),
      problems: entry,
    });

    const prior = await createContest(api, {
      startTime: hoursFromNow(-30),
      endTime: hoursFromNow(-28),
    });
    ended = await createContest(api, {
      startTime: hoursFromNow(-6),
      endTime: hoursFromNow(-4),
      problems: entry,
    });
    const rating = (
      contest: Contest,
      user: string,
      participation: string,
      value: number,
    ) => ({
      user,
      contest: contest._id,
      participation,
      contestEndTime: contest.endTime,
      rank: 1,
      rating: value,
      mean: value,
      performance: value,
      lastRated: contest.endTime,
    });
    const alicePrior = await joinParticipation(api, prior._id, users.alice._id);
    const aliceEnded = await joinParticipation(
      api,
      ended._id,
      users.alice._id,
      {
        score: 100,
        cumtime: 60,
        formatData: { [problemId]: { points: 100, time: 60 } },
      },
    );
    const bobEnded = await joinParticipation(api, ended._id, users.bob._id);
    // A spectator row of the ended contest: never listed or ranked.
    await joinParticipation(api, ended._id, users.viewer._id, { virtual: -1 });
    await api.ratings.create([
      rating(prior, users.alice._id, alicePrior._id, 1500),
      rating(ended, users.alice._id, aliceEnded._id, 1620),
      rating(ended, users.bob._id, bobEnded._id, 1450),
    ]);

    frozen = await createContest(api, {
      formatName: 'icpc',
      startTime: hoursFromNow(-4),
      endTime: hoursFromNow(-1),
      frozenLastMinutes: 120,
      authors: [users.editor._id],
      problems: entry,
    });
    const frozenAlice = await joinParticipation(
      api,
      frozen._id,
      users.alice._id,
      {
        score: 3,
        cumtime: 30,
        formatData: { [problemId]: liveCell },
        frozenScore: 1,
        frozenCumtime: 10,
        frozenFormatData: { [problemId]: frozenCell },
      },
    );
    // The rating of the live standings: the frozen board must not carry it.
    await api.ratings.create([
      rating(frozen, users.alice._id, frozenAlice._id, 1700),
    ]);

    running = await createContest(api, {
      scoreboardVisibility: 'C',
      viewContestScoreboard: [users.viewer._id],
      authors: [users.editor._id],
      problems: [contestProblem(problemId, 0, { isPretested: true })],
    });
    const runningAlice = await joinParticipation(
      api,
      running._id,
      users.alice._id,
    );
    await makeCurrent(api, users.alice._id, runningAlice._id);

    hiddenBoard = await createContest(api, {
      scoreboardVisibility: 'H',
      startTime: hoursFromNow(-6),
      endTime: hoursFromNow(-4),
      authors: [users.editor._id],
    });
    await joinParticipation(api, hiddenBoard._id, users.alice._id, {
      score: 50,
    });

    unrated = await createContest(api, { rateAll: true });
    pretested = await createContest(api, {
      startTime: hoursFromNow(-6),
      endTime: hoursFromNow(-4),
      runPretestsOnly: true,
      problems: [
        contestProblem(problemId, 0, { isPretested: true, maxSubmissions: 3 }),
        contestProblem(otherProblemId, 1, { isPretested: false }),
      ],
    });
    configured = await createContest(api, {
      tags: ['dp', 'ioi'],
      ratingFloor: 1000,
      ratingCeiling: 2000,
      scoreboardVisibility: 'C',
      isPrivate: true,
      isOrganizationPrivate: true,
      organizations: [organizationId],
      authors: [users.editor._id],
    });
  });
  afterAll(() => api.teardown());

  it('lists visible contests by id with the legacy fields and filters', async () => {
    const page = await bodyOf(
      get('/api/v2/contests?is_rated=true&tag=dp&tag=greedy&cachebuster=1'),
    );
    expect(page.data.objects).toEqual([
      {
        key: rated.key,
        name: rated.name,
        start_time: isoformat(rated.startTime),
        end_time: isoformat(rated.endTime),
        time_limit: 7200,
        is_rated: true,
        rate_all: true,
        tags: ['dp'],
      },
    ]);
    expect(page.data).toMatchObject({
      page_index: 1,
      total_objects: 1,
      total_pages: 1,
      has_more: false,
    });
    const keys = (await bodyOf(get('/api/v2/contests'))).data.objects.map(
      (object) => object.key,
    );
    expect(keys).not.toContain(privateContest.key);
    expect(keys).toContain(rated.key);
    await get('/api/v2/contests?page=2').expect(404);
  });

  it('shows contest detail with problems only to those in it, after the end or to editors, and rankings with ratings', async () => {
    const detail = (await bodyOf(get(`/api/v2/contest/${ended.key}`))).data
      .object;
    expect(detail.problems).toEqual([
      {
        points: 100,
        partial: true,
        is_pretested: false,
        max_submissions: null,
        label: '1',
        name: 'ONE',
        code: 'one',
      },
    ]);
    expect(
      detail.rankings.map((row: Row) => [
        row.user,
        row.score,
        row.old_rating,
        row.new_rating,
        row.solutions,
      ]),
    ).toEqual([
      ['alice', 100, 1500, 1620, [{ points: 100, time: 60 }]],
      ['bob', 0, null, 1450, [null]],
    ]);
    expect(detail.has_rating).toBe(true);
    expect(detail.format).toEqual({ name: 'default', config: {} });
    const upcoming = (await bodyOf(get(`/api/v2/contest/${future.key}`))).data
      .object;
    expect([upcoming.problems, upcoming.rankings]).toEqual([[], []]);
    await get(`/api/v2/contest/${privateContest.key}`)
      .expect(404)
      .expect(({ body }) =>
        expect((body as LegacyBody).error).toEqual({
          code: 404,
          message: 'page/object not found',
        }),
      );
  });

  it('orders tied rankings by participation id, whatever order the rows were stored in', async () => {
    const tied = await createContest(api, {
      startTime: hoursFromNow(-6),
      endTime: hoursFromNow(-4),
    });
    const [lowerId, higherId] = [newId(), newId()].sort((left, right) =>
      left.localeCompare(right),
    );
    // Stored higher id first: the database's natural order is the wrong one.
    await joinParticipation(api, tied._id, users.bob._id, { _id: higherId });
    await joinParticipation(api, tied._id, users.alice._id, { _id: lowerId });
    const rows = (await bodyOf(get(`/api/v2/contest/${tied.key}`))).data.object
      .rankings;
    expect(rows.map((row: Row) => row.user)).toEqual(['alice', 'bob']);
  });

  it('shows non-editors only frozen standings in contest detail and participations, editors the live ones', async () => {
    const anonymous = (await bodyOf(get(`/api/v2/contest/${frozen.key}`))).data
      .object;
    expect(
      anonymous.rankings.map((row: Row) => [
        row.score,
        row.cumulative_time,
        row.solutions,
      ]),
    ).toEqual([[1, 10, [frozenCell]]]);
    const editor = (
      await bodyOf(
        authed(get(`/api/v2/contest/${frozen.key}`), sessions.editor),
      )
    ).data.object;
    expect(
      editor.rankings.map((row: Row) => [row.score, row.solutions]),
    ).toEqual([[3, [liveCell]]]);
    expect(anonymous.rankings.map((row: Row) => row.new_rating)).toEqual([
      null,
    ]);
    expect(anonymous.rankings.map((row: Row) => row.old_rating)).toEqual([
      null,
    ]);
    expect(editor.rankings.map((row: Row) => row.new_rating)).toEqual([1700]);
    const participations = (
      await bodyOf(get(`/api/v2/participations?contest=${frozen.key}`))
    ).data.objects;
    expect(
      participations.map((row) => [row.user, row.score, row.cumulative_time]),
    ).toEqual([['alice', 1, 10]]);
    const forEditor = (
      await bodyOf(
        authed(
          get(`/api/v2/participations?contest=${frozen.key}`),
          sessions.editor,
        ),
      )
    ).data.objects;
    expect(forEditor.map((row) => row.score)).toEqual([3]);
  });

  it('lists participations of ended or scoreboard-visible contests only, never spectators, with filters', async () => {
    const all = (await bodyOf(get('/api/v2/participations'))).data.objects;
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((row) => row.contest !== running.key)).toBe(true);
    expect(
      all.every((row) => Number(row.virtual_participation_number) >= 0),
    ).toBe(true);
    expect(all.map((row) => row.user)).not.toContain('viewer');
    const listed = (
      await bodyOf(
        authed(
          get(`/api/v2/participations?contest=${running.key}`),
          sessions.viewer,
        ),
      )
    ).data.objects;
    expect(listed).toHaveLength(1);
    expect(
      (await bodyOf(get(`/api/v2/participations?contest=${running.key}`))).data
        .objects,
    ).toEqual([]);
    const filtered = (
      await bodyOf(
        get(
          '/api/v2/participations?user=alice&is_disqualified=false&virtual_participation_number=0',
        ),
      )
    ).data.objects;
    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every(
        (row) =>
          row.user === 'alice' &&
          row.virtual_participation_number === 0 &&
          !row.is_disqualified,
      ),
    ).toBe(true);
    expect(
      (await bodyOf(get('/api/v2/participations?user=nobody'))).data.objects,
    ).toEqual([]);
    await get('/api/v2/participations?user=nobody&page=2').expect(404);
  });

  it('shows the problems of a running contest to its participants and editors, not to outsiders', async () => {
    const problemsOf = async (who?: string) => {
      const request = get(`/api/v2/contest/${running.key}`);
      return (await bodyOf(who ? authed(request, sessions[who]) : request)).data
        .object.problems;
    };
    expect(await problemsOf('alice')).toEqual([
      expect.objectContaining({ code: 'one', label: '1' }),
    ]);
    expect(await problemsOf('editor')).toHaveLength(1);
    expect(await problemsOf('bob')).toEqual([]);
    expect(await problemsOf()).toEqual([]);
  });

  it('lists the participations of a running contest to its author', async () => {
    const url = `/api/v2/participations?contest=${running.key}`;
    const asEditor = await bodyOf(authed(get(url), sessions.editor));
    expect(asEditor.data.objects.map((row) => row.user)).toEqual(['alice']);
    const asOutsider = await bodyOf(authed(get(url), sessions.bob));
    expect(asOutsider.data.objects).toEqual([]);
  });

  it('shows the flags, bounds and tags of a contest in its detail', async () => {
    const detail = (
      await bodyOf(
        authed(get(`/api/v2/contest/${configured.key}`), sessions.editor),
      )
    ).data.object;
    expect(detail).toMatchObject({
      tags: ['dp', 'ioi'],
      rating_floor: 1000,
      rating_ceiling: 2000,
      hidden_scoreboard: true,
      scoreboard_visibility: 'C',
      is_private: true,
      is_organization_private: true,
      organizations: [organizationId],
      has_rating: false,
    });
    const open = (await bodyOf(get(`/api/v2/contest/${ended.key}`))).data
      .object;
    expect(open).toMatchObject({
      hidden_scoreboard: false,
      organizations: [],
      rating_floor: null,
      rating_ceiling: null,
    });
    const pretestedProblems = (
      await bodyOf(get(`/api/v2/contest/${pretested.key}`))
    ).data.object.problems as Row[];
    expect(
      pretestedProblems.map((problem) => [
        problem.is_pretested,
        problem.max_submissions,
      ]),
    ).toEqual([
      [true, 3],
      [false, null],
    ]);
    const runningProblems = (
      await bodyOf(
        authed(get(`/api/v2/contest/${running.key}`), sessions.editor),
      )
    ).data.object.problems as Row[];
    // Pretested problems count only in a contest that runs pretests only.
    expect(runningProblems[0].is_pretested).toBe(false);
  });

  it('reports rate_all only for rated contests', async () => {
    const [object] = (await bodyOf(get(`/api/v2/contests?key=${unrated.key}`)))
      .data.objects;
    expect(object).toMatchObject({ is_rated: false, rate_all: false });
  });

  it('hides participations wherever the contest hides its rankings', async () => {
    const url = `/api/v2/participations?contest=${hiddenBoard.key}`;
    const detailUrl = `/api/v2/contest/${hiddenBoard.key}`;
    expect((await bodyOf(get(url))).data.objects).toEqual([]);
    expect((await bodyOf(get(detailUrl))).data.object.rankings).toEqual([]);
    expect((await bodyOf(authed(get(url), sessions.bob))).data.objects).toEqual(
      [],
    );
    const asEditor = await bodyOf(authed(get(url), sessions.editor));
    expect(asEditor.data.objects.map((row) => row.score)).toEqual([50]);
    expect(
      (await bodyOf(authed(get(detailUrl), sessions.editor))).data.object
        .rankings,
    ).toHaveLength(1);
  });

  it('answers legacy-valid but unmatched filters with an empty page', async () => {
    for (const query of [
      'virtual_participation_number=-1',
      `user=${'x'.repeat(40)}`,
      `contest=${'x'.repeat(40)}`,
    ])
      expect(
        (await bodyOf(get(`/api/v2/participations?${query}`))).data.objects,
      ).toEqual([]);
  });

  it('pages 12k participations through indexes', async () => {
    const db = api.app.get<Connection>(getConnectionToken()).db!;
    const big = await createContest(api, {
      startTime: hoursFromNow(-6),
      endTime: hoursFromNow(-4),
    });
    await db.collection<{ _id: UUID }>('contestParticipations').insertMany(
      Array.from({ length: 12_000 }, (_unused, index) => ({
        _id: toUuid(newId()),
        contest: toUuid(big._id),
        user: toUuid(newId()),
        realStart: new Date(),
        virtual: 0,
        score: index,
        cumtime: 0,
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
    const url = (page: number) =>
      `/api/v2/participations?contest=${big.key}&page=${page}`;
    let lastPage: LegacyBody | undefined;
    const operations = await profileQueries(db, async () => {
      lastPage = await bodyOf(get(url(12)));
    });
    expect(lastPage!.data).toMatchObject({
      current_object_count: 1000,
      total_objects: 12_000,
      total_pages: 12,
      has_more: false,
    });
    expect(
      operations
        .filter(({ collection }) => collection === 'contestParticipations')
        .every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    await get(url(13)).expect(404);
  });
});
