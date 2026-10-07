import type { User } from '@libs/database';
import {
  contestProblem,
  createContest,
  hoursFromNow,
  joinParticipation,
} from './contest-fixtures';
import { createOrganization } from './organization-fixtures';
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
type LegacyBody = {
  data: { objects: Row[]; object: Row; total_objects: number };
  error?: { code: number; message: string };
};

describe('/api/v2 organizations and users', () => {
  let api: ApiTest;
  const users: Record<string, { _id: string }> = {};
  const sessions: Record<string, TestSession> = {};
  let listed: { _id: string };
  let unlisted: { _id: string };
  const body = async (url: string, session?: TestSession, status = 200) =>
    (
      await (
        session ? authed(api.http().get(url), session) : api.http().get(url)
      ).expect(status)
    ).body as LegacyBody;

  beforeAll(async () => {
    api = await setupApiTest();
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      [
        'alice',
        {
          points: 10,
          performancePoints: 20,
          problemCount: 1,
          rating: 1500,
          displayRank: 'setter',
        },
      ],
      ['bob', {}],
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['hidden', { isUnlisted: true }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    listed = await createOrganization(
      api,
      { slug: 'listed', shortName: 'LST' },
      [users.alice._id],
    );
    unlisted = await createOrganization(
      api,
      { slug: 'unlisted', isUnlisted: true, isOpen: false, memberCount: 7 },
      [users.alice._id, users.bob._id],
    );
    const solvedProblem = await createProblem(api, catalog, {
      code: 'solved_one',
    });
    const partialProblem = await createProblem(api, catalog, {
      code: 'partial_one',
    });
    const orgPrivateProblem = await createProblem(api, catalog, {
      code: 'org_private_one',
      isOrganizationPrivate: true,
    });
    const privateProblem = await createProblem(api, catalog, {
      code: 'private_one',
      isPublic: false,
    });
    const submit = (problem: string, fields: Row) =>
      api.submissions.create({
        user: users.alice._id,
        problem,
        language: catalog.languages.cpp,
        status: 'D',
        result: 'AC',
        casePoints: 1,
        caseTotal: 1,
        points: 1000,
        ...fields,
      });
    await submit(solvedProblem._id, {});
    await submit(partialProblem._id, { casePoints: 1, caseTotal: 2 });
    await submit(privateProblem._id, {});
    await submit(orgPrivateProblem._id, {});
    const ended = await createContest(api, {
      key: 'ended_one',
      startTime: hoursFromNow(-30),
      endTime: hoursFromNow(-28),
    });
    const frozen = await createContest(api, {
      key: 'frozen_one',
      formatName: 'icpc',
      startTime: hoursFromNow(-4),
      endTime: hoursFromNow(-1),
      frozenLastMinutes: 120,
      authors: [users.editor._id],
      problems: [contestProblem(solvedProblem._id, 0)],
    });
    await createContest(api, { key: 'running_one' });
    const secret = await createContest(api, {
      key: 'secret_one',
      isPrivate: true,
      startTime: hoursFromNow(-10),
      endTime: hoursFromNow(-9),
    });
    const hiddenBoard = await createContest(api, {
      key: 'hidden_board_one',
      scoreboardVisibility: 'H',
      authors: [users.editor._id],
      startTime: hoursFromNow(-20),
      endTime: hoursFromNow(-19),
    });
    const endedRow = await joinParticipation(api, ended._id, users.alice._id, {
      score: 50,
      cumtime: 5,
    });
    const frozenRow = await joinParticipation(
      api,
      frozen._id,
      users.alice._id,
      {
        score: 300,
        cumtime: 30,
        frozenScore: 100,
        frozenCumtime: 10,
      },
    );
    await joinParticipation(api, secret._id, users.alice._id, { score: 9 });
    const hiddenRow = await joinParticipation(
      api,
      hiddenBoard._id,
      users.alice._id,
      { score: 7 },
    );
    await api.ratings.create({
      user: users.alice._id,
      contest: hiddenBoard._id,
      participation: hiddenRow._id,
      contestEndTime: hiddenBoard.endTime,
      rank: 3,
      rating: 1550,
      mean: 1555,
      performance: 1650,
      lastRated: new Date(),
    });
    await api.ratings.create({
      user: users.alice._id,
      contest: frozen._id,
      participation: frozenRow._id,
      contestEndTime: frozen.endTime,
      rank: 1,
      rating: 1700,
      mean: 1710,
      performance: 1800,
      lastRated: new Date(),
    });
    await api.ratings.create({
      user: users.alice._id,
      contest: ended._id,
      participation: endedRow._id,
      contestEndTime: ended.endTime,
      rank: 1,
      rating: 1500,
      mean: 1510.5,
      performance: 1600.25,
      lastRated: new Date(),
    });
  });
  afterAll(() => api.teardown());

  it('hides unlisted organizations from outsiders in every legacy endpoint', async () => {
    expect(
      (await body('/api/v2/organizations')).data.objects.map((row) => row.slug),
    ).toEqual(['listed']);
    expect(
      (await body('/api/v2/organizations', sessions.bob)).data.objects
        .map((row) => row.slug)
        .sort(),
    ).toEqual(['listed', 'unlisted']);
    expect(
      (await body(`/api/v2/users?organization=${unlisted._id}`)).data.objects,
    ).toEqual([]);
    expect(
      (
        await body(`/api/v2/users?organization=${unlisted._id}`, sessions.bob)
      ).data.objects
        .map((row) => row.username)
        .sort(),
    ).toEqual(['alice', 'bob']);
    expect(
      (await body('/api/v2/user/alice')).data.object.organizations,
    ).toEqual([listed._id]);
    expect(
      (await body('/api/v2/user/alice', sessions.bob)).data.object
        .organizations,
    ).toEqual([listed._id, unlisted._id]);
  });

  it('lists organizations with legacy fields and filters', async () => {
    const page = await body(
      '/api/v2/organizations?is_open=false',
      sessions.bob,
    );
    expect(page.data.objects).toEqual([
      {
        id: unlisted._id,
        slug: 'unlisted',
        short_name: 'unlisted',
        is_open: false,
        member_count: 7,
      },
    ]);
    expect(
      (await body(`/api/v2/organizations?id=${listed._id}`)).data.objects.map(
        (row) => row.short_name,
      ),
    ).toEqual(['LST']);
  });

  it('lists listed, active users with legacy fields and filters', async () => {
    const page = await body('/api/v2/users?username=ALICE&username=bob');
    expect(page.data.objects).toEqual([
      {
        id: users.alice._id,
        username: 'alice',
        points: 10,
        performance_points: 20,
        problem_count: 1,
        rank: 'setter',
        rating: 1500,
      },
      {
        id: users.bob._id,
        username: 'bob',
        points: 0,
        performance_points: 0,
        problem_count: 0,
        rank: 'user',
        rating: null,
      },
    ]);
    expect((await body('/api/v2/users?username=hidden')).data.objects).toEqual(
      [],
    );
    expect(
      (await body(`/api/v2/users?id=${users.bob._id}`)).data.objects.map(
        (row) => row.username,
      ),
    ).toEqual(['bob']);
  });

  it('details a user with solved problems and a freeze-safe contest history', async () => {
    const outsider = (await body('/api/v2/user/alice')).data.object;
    expect(outsider).toMatchObject({
      id: users.alice._id,
      username: 'alice',
      solved_problems: ['solved_one'],
      rank: 'setter',
      rating: 1500,
    });
    expect(outsider.contests).toEqual([
      {
        key: 'ended_one',
        score: 50,
        cumulative_time: 5,
        rating: 1500,
        raw_rating: 1510.5,
        performance: 1600.25,
      },
      {
        key: 'frozen_one',
        score: 100,
        cumulative_time: 10,
        rating: null,
        raw_rating: null,
        performance: null,
      },
    ]);
    const asEditor = (await body('/api/v2/user/alice', sessions.editor)).data
      .object.contests as Row[];
    expect(asEditor.find((row) => row.key === 'frozen_one')).toMatchObject({
      score: 300,
      cumulative_time: 30,
      rating: 1700,
      raw_rating: 1710,
      performance: 1800,
    });
    expect(
      asEditor.find((row) => row.key === 'hidden_board_one'),
    ).toMatchObject({ score: 7, rating: 1550, performance: 1650 });
    const missing = await body('/api/v2/user/nobody', undefined, 404);
    expect(missing.error).toEqual({
      code: 404,
      message: 'page/object not found',
    });
  });

  it('answers 400 for malformed filters and 404 past the last page', async () => {
    await body('/api/v2/users?id=not-a-uuid', undefined, 400);
    await body('/api/v2/users?organization=not-a-uuid', undefined, 400);
    await body('/api/v2/organizations?id=not-a-uuid', undefined, 400);
    await body('/api/v2/users?page=0', undefined, 400);
    await body('/api/v2/organizations?page=0', undefined, 400);
    await body('/api/v2/users?page=2', undefined, 404);
    await body('/api/v2/organizations?page=2', undefined, 404);
  });

  it('details an unlisted user, as legacy does', async () => {
    const detail = (await body('/api/v2/user/hidden')).data.object;
    expect(detail).toMatchObject({ username: 'hidden', solved_problems: [] });
  });
});
