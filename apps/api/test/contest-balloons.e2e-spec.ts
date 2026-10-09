import { Logger } from '@nestjs/common';
import { profileQueries } from '@libs/database/testing';
import type { Contest, User } from '@libs/database';
import type { BalloonResponse } from '../src/modules/contests/balloons/dto/balloons.dto';
import {
  clearRateLimits,
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
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

interface BalloonPage {
  data: BalloonResponse[];
  meta: {
    total: number;
    pendingTotal: number | null;
    deliveredTotal: number | null;
  };
}

/** A refusal carries its error code and a stable `issues[].code`. */
const refusedWith =
  (code: string, issueCode = code) =>
  ({ body }: { body: unknown }) => {
    const { error } = body as {
      error: { code: string; issues?: { code: string }[] };
    };
    expect(error.code).toBe(code);
    expect(error.issues?.map((issue) => issue.code)).toContain(issueCode);
  };
/** Same for a 400: whatever the field, every issue has a code. */
const hasIssueCodes = ({ body }: { body: unknown }) => {
  const { issues } = (body as { error: { issues?: { code: string }[] } }).error;
  expect(issues?.length).toBeGreaterThan(0);
  expect(issues?.every((issue) => issue.code)).toBe(true);
};

describe('contest balloons', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Array<{ _id: string }> = [];
  const solved = (time: number) => ({ time, points: 100, tries: 1 });
  const url = (contest: Contest, suffix = '') =>
    contestUrl(contest.key, `/balloons${suffix}`);
  const read = async (
    contest: Contest,
    who = 'volunteer',
    query = '?state=all',
  ) =>
    (
      await authed(api.http().get(url(contest, query)), sessions[who]).expect(
        200,
      )
    ).body as BalloonPage;
  const names = (page: BalloonPage) =>
    page.data.map(
      (item) =>
        `${item.team.username}:${item.problemCode}${item.isFirst ? '*' : ''}`,
    );
  const act = (
    contest: Contest,
    [participation, problem]: [string, string],
    action: string,
    who = 'volunteer',
  ) =>
    authed(
      api.http().post(url(contest, `/${participation}/${problem}/${action}`)),
      sessions[who],
    );

  /** ann solves A at 600 s, bob A at 900 s and B at 1200 s, cy has a partial A. */
  const seed = async (extra: Partial<Contest> = {}) => {
    const contest = await createContest(api, {
      formatName: 'icpc',
      balloons: true,
      authors: [users.editor._id],
      balloonStaff: [users.volunteer._id],
      problems: [
        contestProblem(problems[0]._id, 0),
        contestProblem(problems[1]._id, 1),
      ],
      ...extra,
    });
    const [probA, probB] = [problems[0]._id, problems[1]._id];
    const ann = await joinParticipation(api, contest._id, users.ann._id, {
      formatData: { [probA]: solved(600) },
    });
    const bob = await joinParticipation(api, contest._id, users.bob._id, {
      formatData: { [probA]: solved(900), [probB]: solved(1200) },
    });
    await joinParticipation(api, contest._id, users.cy._id, {
      formatData: { [probA]: { time: 300, points: 50, tries: 2 } },
    });
    return { contest, ann, bob, probA, probB };
  };

  beforeAll(async () => {
    api = await setupApiTest();
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['volunteer', {}],
      ['plain', {}],
      ['ann', {}],
      ['bob', {}],
      ['cy', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.push(
      await createProblem(api, catalog, { code: 'bal_a' }),
      await createProblem(api, catalog, { code: 'bal_b' }),
    );
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));

  it('lists the first solves and the rest in delivery order, with labels, and pages them', async () => {
    const { contest } = await seed();
    const page = await read(contest);
    expect(names(page)).toEqual(['ann:bal_a*', 'bob:bal_a', 'bob:bal_b*']);
    expect(page.data[0]).toMatchObject({
      problemLabel: '1',
      solvedAt: 600,
      deliveredAt: null,
      deliveredBy: null,
    });
    expect(page.meta).toMatchObject({
      total: 3,
      pendingTotal: 3,
      deliveredTotal: 0,
    });
    const second = await read(
      contest,
      'volunteer',
      '?state=all&pageSize=1&page=2',
    );
    expect(names(second)).toEqual(['bob:bal_a']);
    expect(second.meta.total).toBe(3);
  });

  it('delivers and undelivers, filters by state, refuses repeats and unsolved cells with coded issues', async () => {
    const { contest, ann, bob, probA, probB } = await seed();
    await act(contest, [ann._id, probA], 'deliver').expect(204);
    expect(names(await read(contest, 'volunteer', '?state=pending'))).toEqual([
      'bob:bal_a',
      'bob:bal_b*',
    ]);
    const delivered = await read(contest, 'volunteer', '?state=delivered');
    expect(delivered.data).toHaveLength(1);
    expect(delivered.data[0]).toMatchObject({ deliveredBy: 'volunteer' });
    await act(contest, [ann._id, probA], 'deliver')
      .expect(409)
      .expect(refusedWith('conflict', 'already_delivered'));
    await act(contest, [ann._id, probA], 'undeliver').expect(204);
    await act(contest, [ann._id, probA], 'undeliver')
      .expect(409)
      .expect(refusedWith('conflict', 'not_delivered'));
    await act(contest, [ann._id, probB], 'deliver')
      .expect(404)
      .expect(refusedWith('not_found', 'balloon_not_found'));
    expect(
      (await read(contest, 'volunteer', '?state=pending')).meta.pendingTotal,
    ).toBe(3);
    await act(contest, [bob._id, probA], 'deliver').expect(204);
  });

  it('follows a rescore: the first flag moves and a delivery for a vanished solve is hidden, then returns with the solve', async () => {
    const { contest, ann, probA } = await seed();
    await act(contest, [ann._id, probA], 'deliver').expect(204);
    await api.participations.updateOne({ _id: ann._id }, { formatData: {} });
    expect(names(await read(contest))).toEqual(['bob:bal_a*', 'bob:bal_b*']);
    expect((await read(contest, 'volunteer', '?state=delivered')).data).toEqual(
      [],
    );
    await api.participations.updateOne(
      { _id: ann._id },
      { formatData: { [probA]: solved(600) } },
    );
    expect(
      (await read(contest, 'volunteer', '?state=delivered')).data,
    ).toHaveLength(1);
  });

  it('lists live solves during a freeze, without solve times or totals for a volunteer, while the ranking stays frozen', async () => {
    const { contest } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(0.2),
      frozenLastMinutes: 30,
    });
    await api.participations.updateOne(
      { contest: contest._id, user: users.ann._id },
      {
        score: 100,
        frozenScore: 0,
        frozenFormatData: {
          [problems[0]._id]: { time: null, points: 0, tries: 1, pending: true },
        },
      },
    );
    const asVolunteer = await read(contest);
    expect(names(asVolunteer)).toContain('ann:bal_a*');
    expect(asVolunteer.data.map((item) => item.solvedAt)).toEqual([
      null,
      null,
      null,
    ]);
    expect(asVolunteer.meta).toMatchObject({
      total: 3,
      pendingTotal: null,
      deliveredTotal: null,
    });
    const asEditor = await read(contest, 'editor');
    expect(asEditor.data[0].solvedAt).toBe(600);
    expect(asEditor.meta.pendingTotal).toBe(3);
    const board = await authed(
      api.http().get(contestUrl(contest.key, '/ranking')),
      sessions.volunteer,
    ).expect(200);
    const row = (
      board.body as {
        data: {
          frozen: boolean;
          rows: Array<{ user: { username: string }; score: number }>;
        };
      }
    ).data;
    expect(row.frozen).toBe(true);
    expect(row.rows.find((item) => item.user.username === 'ann')!.score).toBe(
      0,
    );
  });

  it('logs one audit line per user and minute for a read during a freeze, and none outside a freeze', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const auditLines = () =>
      log.mock.calls
        .map(
          ([entry]) =>
            entry as { event?: string; contestId?: string; actorId?: string },
        )
        .filter((entry) => entry.event === 'balloons.read_frozen');
    const calm = (await seed()).contest;
    await read(calm);
    expect(auditLines()).toEqual([]);
    const { contest } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(0.2),
      frozenLastMinutes: 30,
    });
    await read(contest);
    await read(contest);
    await read(contest, 'editor');
    expect(auditLines()).toEqual([
      {
        event: 'balloons.read_frozen',
        contestId: contest._id,
        actorId: users.volunteer._id,
      },
      {
        event: 'balloons.read_frozen',
        contestId: contest._id,
        actorId: users.editor._id,
      },
    ]);
    log.mockRestore();
  });

  it('refuses a listed volunteer who holds a participation, to read and to write, but never an editor', async () => {
    const { contest, ann, probA } = await seed();
    await api.contests.updateOne(
      { _id: contest._id },
      {
        balloonStaff: [
          users.volunteer._id,
          users.ann._id,
          users.plain._id,
          users.editor._id,
        ],
      },
    );
    await joinParticipation(api, contest._id, users.plain._id, { virtual: -1 });
    for (const who of ['ann', 'plain']) {
      await authed(api.http().get(url(contest)), sessions[who])
        .expect(403)
        .expect(refusedWith('forbidden', 'contestant_forbidden'));
      await act(contest, [ann._id, probA], 'deliver', who).expect(403);
      await act(contest, [ann._id, probA], 'undeliver', who).expect(403);
    }
    await joinParticipation(api, contest._id, users.editor._id, {});
    expect((await read(contest, 'editor')).data).toHaveLength(3);
    expect((await read(contest)).data).toHaveLength(3);
  });

  it('leaves disqualified, virtual and spectating rows out', async () => {
    const { contest } = await seed();
    const solvedCell = { [problems[1]._id]: solved(100) };
    await joinParticipation(api, contest._id, users.plain._id, {
      isDisqualified: true,
      formatData: solvedCell,
    });
    expect(names(await read(contest))).toHaveLength(3);
    await api.participations.updateOne(
      { contest: contest._id, user: users.plain._id },
      { isDisqualified: false, virtual: 1 },
    );
    expect(names(await read(contest))).toHaveLength(3);
  });

  it('opens to listed volunteers and editors only, not to results or editing, and is 404 when balloons are off', async () => {
    const { contest } = await seed({ scoreboardVisibility: 'H' });
    expect((await read(contest, 'editor')).data).toHaveLength(3);
    await authed(api.http().get(url(contest)), sessions.plain)
      .expect(403)
      .expect(refusedWith('forbidden', 'balloons_forbidden'));
    await api.http().get(url(contest)).expect(401);
    await authed(
      api.http().get(contestUrl(contest.key, '/ranking')),
      sessions.volunteer,
    ).expect(403);
    await authed(
      api.http().patch(contestUrl(contest.key)).send({ name: 'X' }),
      sessions.volunteer,
    ).expect(403);
    await act(
      contest,
      [users.ann._id, problems[0]._id],
      'deliver',
      'plain',
    ).expect(403);
    await api.contests.updateOne({ _id: contest._id }, { balloons: false });
    for (const who of ['volunteer', 'editor'])
      await authed(api.http().get(url(contest)), sessions[who])
        .expect(404)
        .expect(refusedWith('not_found', 'balloons_off'));
  });

  it('lets a listed volunteer reach a private contest, and nobody else', async () => {
    const { contest } = await seed({ isPrivate: true });
    expect((await read(contest)).data).toHaveLength(3);
    await authed(api.http().get(url(contest)), sessions.plain)
      .expect(404)
      .expect(refusedWith('not_found'));
  });

  it('answers 404, not 403, to a volunteer listed on a contest they cannot see, on every route', async () => {
    const { contest, ann, probA } = await seed({
      isVisible: false,
      isPrivate: true,
    });
    await authed(api.http().get(url(contest)), sessions.volunteer)
      .expect(404)
      .expect(refusedWith('not_found'));
    for (const action of ['deliver', 'undeliver'])
      await act(contest, [ann._id, probA], action)
        .expect(404)
        .expect(refusedWith('not_found'));
    expect((await read(contest, 'editor')).data).toHaveLength(3);
  });

  it('writes nothing on a GET', async () => {
    const { contest } = await seed();
    const operations = await profileQueries(api.db, () =>
      authed(
        api.http().get(url(contest, '?state=all')),
        sessions.volunteer,
      ).expect(200),
    );
    const balloonOperations = operations.filter(
      (operation) => operation.collection === 'contestBalloons',
    );
    expect(balloonOperations.length).toBeGreaterThan(0);
    expect(
      balloonOperations.every((operation) => operation.operation === 'query'),
    ).toBe(true);
    expect(
      await api.balloonDeliveries.countDocuments({ contest: contest._id }),
    ).toBe(0);
  });

  it('allows 120 writes a minute per user, then refuses with a coded 429', async () => {
    const { contest, ann, probB } = await seed();
    for (let count = 0; count < 120; count += 1)
      await act(contest, [ann._id, probB], 'deliver').expect(404);
    await act(contest, [ann._id, probB], 'deliver')
      .expect(429)
      .expect(refusedWith('rate_limited'))
      .expect((response) =>
        expect(response.headers['retry-after']).toBeDefined(),
      );
  });

  it('refuses a malformed state and malformed ids with coded issues', async () => {
    const { contest } = await seed();
    await authed(
      api.http().get(url(contest, '?state=nope')),
      sessions.volunteer,
    )
      .expect(400)
      .expect(hasIssueCodes);
    await authed(
      api.http().get(url(contest, '?pageSize=1000')),
      sessions.volunteer,
    )
      .expect(400)
      .expect(hasIssueCodes);
    await act(contest, ['not-a-uuid', problems[0]._id], 'deliver')
      .expect(400)
      .expect(hasIssueCodes);
  });
});
