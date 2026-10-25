import { existsSync, writeFileSync } from 'node:fs';
import { contestDataPath, contestExportPath } from '@libs/contests';
import type { User } from '@libs/database';
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
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

let api: ApiTest;
const errorCode = (response: { body: { error?: { code: string } } }) =>
  response.body.error?.code;
let catalog: Catalog;
const sessions: Record<string, TestSession> = {};
const users: Record<string, { _id: string }> = {};
let problemId: string;

beforeAll(async () => {
  api = await setupApiTest();
  catalog = await seedCatalog(api);
  const roles: Array<[string, Partial<User>]> = [
    ['alice', {}],
    ['editor', { permissions: ['judge.edit_own_contest'] }],
    [
      'judge',
      {
        permissions: ['judge.edit_own_contest', 'judge.rejudge_submission'],
      },
    ],
  ];
  for (const [name, extra] of roles) {
    users[name] = await createUserWith(api, name, extra);
    sessions[name] = await loginAs(api, users[name]._id);
  }
  problemId = (await createProblem(api, catalog, { code: 'alpha' }))._id;
});
afterAll(() => api.teardown());

const ownedContest = (extra: Parameters<typeof createContest>[1] = {}) =>
  createContest(api, {
    authors: [users.editor._id, users.judge._id],
    problems: [contestProblem(problemId, 0)],
    ...extra,
  });

const seedIn = (contestId: string | null, extra = {}) =>
  seedSubmission(api, {
    problem: problemId,
    language: catalog.languages.cpp,
    user: users.alice._id,
    contest: contestId,
    ...extra,
  });

describe('rejudging one contest problem', () => {
  const rejudge = (key: string, who: string, body: object) =>
    authed(
      api.http().post(contestUrl(key, '/problems/alpha/rejudge')).send(body),
      sessions[who],
    );

  it("counts only the problem's submissions in this contest, skipping locked ones unless forced", async () => {
    const contest = await ownedContest();
    await seedIn(contest._id);
    await seedIn(contest._id, { lockedAfter: hoursFromNow(-1) });
    await seedIn(null);
    const count = async (force: boolean) =>
      dataOf<{ count: number }>(
        await rejudge(contest.key, 'judge', { dryRun: true, force }).expect(
          200,
        ),
      ).count;
    expect(await count(false)).toBe(1);
    expect(await count(true)).toBe(2);
  });

  it('needs judge.rejudge_submission on top of edit rights, and a problem of the contest', async () => {
    const contest = await ownedContest();
    const refused = await rejudge(contest.key, 'editor', { dryRun: true });
    expect(refused.status).toBe(403);
    await createProblem(api, catalog, { code: 'outside' });
    const outside = await authed(
      api
        .http()
        .post(contestUrl(contest.key, '/problems/outside/rejudge'))
        .send({ dryRun: true }),
      sessions.judge,
    );
    expect([outside.status, errorCode(outside)]).toEqual([404, 'not_found']);
  });
});

describe('deleting a contest', () => {
  const remove = (key: string, confirm: string) =>
    authed(
      api.http().delete(contestUrl(key, `?confirm=${confirm}`)),
      sessions.editor,
    );

  it('refuses a wrong confirmation, a visible contest and a rated one', async () => {
    const hidden = await ownedContest({ isVisible: false });
    const mismatch = await remove(hidden.key, 'nope');
    expect([mismatch.status, errorCode(mismatch)]).toEqual([
      400,
      'confirmation_mismatch',
    ]);
    const visible = await ownedContest();
    const shown = await remove(visible.key, visible.key);
    expect([shown.status, errorCode(shown)]).toEqual([
      409,
      'contest_not_deletable',
    ]);
    await api.ratings.create({
      user: users.alice._id,
      contest: hidden._id,
      participation: (await joinParticipation(api, hidden._id, users.alice._id))
        ._id,
      rank: 1,
      rating: 1500,
      mean: 1500,
      performance: 1500,
      lastRated: new Date(),
      contestEndTime: hidden.endTime,
    });
    const rated = await remove(hidden.key, hidden.key);
    expect(rated.status).toBe(409);
    expect(await api.contests.exists({ _id: hidden._id })).not.toBeNull();
  });

  it('deletes what belongs to the contest, keeps its submissions outside any contest and clears current pointers', async () => {
    const contest = await ownedContest({ isVisible: false });
    const participation = await joinParticipation(
      api,
      contest._id,
      users.alice._id,
    );
    await makeCurrent(api, users.alice._id, participation._id);
    const submission = await seedIn(contest._id);
    await api.announcements.create({
      contest: contest._id,
      title: 'Hi',
      description: '',
      descriptionHtml: '',
    });
    const zips = [
      contestExportPath(api.contestDataRoot, contest._id),
      contestDataPath(api.contestDataRoot, contest._id),
    ];
    for (const zip of zips) writeFileSync(zip, 'zip bytes');
    await remove(contest.key, contest.key).expect(204);
    expect(zips.filter((zip) => existsSync(zip))).toEqual([]);
    expect(await api.contests.exists({ _id: contest._id })).toBeNull();
    expect(
      await api.participations.countDocuments({ contest: contest._id }),
    ).toBe(0);
    expect(
      await api.announcements.countDocuments({ contest: contest._id }),
    ).toBe(0);
    const kept = await api.submissions.findById(submission._id).lean();
    expect(kept?.contest).toBeNull();
    const alice = await api.users.findById(users.alice._id).lean();
    expect(alice?.currentParticipation).toBeNull();
  });
});

describe('editing participations by hand', () => {
  const participationsUrl = (key: string, rest = '') =>
    contestUrl(key, `/participations${rest}`);

  it('adds one live row per user and further virtual runs', async () => {
    const contest = await ownedContest();
    const add = (kind: string) =>
      authed(
        api
          .http()
          .post(participationsUrl(contest.key))
          .send({ user: 'alice', kind }),
        sessions.editor,
      );
    await add('live').expect(201);
    const again = await add('live');
    expect([again.status, errorCode(again)]).toEqual([
      409,
      'already_participating',
    ]);
    const virtual = dataOf<{ virtual: number }>(
      await add('virtual').expect(201),
    );
    expect(virtual.virtual).toBe(1);
    const refreshed = await api.contests.findById(contest._id).lean();
    expect([refreshed?.userCount, refreshed?.virtualCount]).toEqual([1, 1]);
  });

  it('deletes a stray row but refuses one with submissions', async () => {
    const contest = await ownedContest();
    const stray = await joinParticipation(api, contest._id, users.alice._id);
    const used = await joinParticipation(api, contest._id, users.alice._id, {
      virtual: 1,
    });
    const submission = await seedIn(contest._id);
    await api.contestSubmissions.create({
      _id: submission._id,
      participation: used._id,
      contest: contest._id,
      problem: problemId,
    });
    const remove = (id: string) =>
      authed(
        api.http().delete(participationsUrl(contest.key, `/${id}`)),
        sessions.editor,
      );
    const refused = await remove(used._id);
    expect([refused.status, errorCode(refused)]).toEqual([
      409,
      'participation_has_submissions',
    ]);
    await remove(stray._id).expect(204);
    expect(await api.participations.exists({ _id: stray._id })).toBeNull();
  });

  it('refuses every write to a user who cannot edit the contest', async () => {
    const contest = await ownedContest();
    const row = await joinParticipation(api, contest._id, users.alice._id);
    const response = await authed(
      api.http().post(participationsUrl(contest.key, `/${row._id}/recompute`)),
      sessions.alice,
    );
    expect(response.status).toBe(403);
  });
});
