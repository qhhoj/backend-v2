import type { ParticipationResponse } from '../src/modules/contests/participation/dto/participation.response';
import {
  clearRateLimits,
  contestUrl,
  createContest,
  hoursFromNow,
} from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf } from './submission-fixtures';

describe('contest rules acceptance', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  const rules = {
    rules: 'No sharing.',
    rulesHtml: '<p>No sharing.</p>',
    rulesRevision: 1,
  };
  const post = (who: string, key: string, action: string, body: object = {}) =>
    authed(api.http().post(contestUrl(key, `/${action}`)), sessions[who]).send(
      body,
    );
  const rowsOf = (contestId: string, who: string) =>
    api.participations
      .find({ contest: contestId, user: ids[who] })
      .sort({ virtual: 1 })
      .lean();
  const newUser = async (name: string, extra: object = {}) => {
    ids[name] = (await createUserWith(api, name, extra))._id;
    sessions[name] = await loginAs(api, ids[name]);
  };

  beforeAll(async () => {
    api = await setupApiTest();
    for (const name of ['alice', 'bob', 'carol', 'dave', 'tester'])
      await newUser(name);
    await newUser('editor', { permissions: ['judge.edit_own_contest'] });
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));

  it('refuses a registration without acceptance and stores time and revision with it', async () => {
    const contest = await createContest(api, {
      ...rules,
      registrationStart: hoursFromNow(-2),
      registrationEnd: hoursFromNow(1),
    });
    const refused = await post('alice', contest.key, 'register').expect(400);
    expect(refused.body).toMatchObject({
      error: {
        code: 'rules_not_accepted',
        issues: [{ field: 'acceptRules', code: 'rules_not_accepted' }],
      },
    });
    await post('alice', contest.key, 'register', { acceptRules: false })
      .expect(400)
      .expect(errorCode('rules_not_accepted'));
    expect(await rowsOf(contest._id, 'alice')).toHaveLength(0);
    await post('alice', contest.key, 'register', { acceptRules: true }).expect(
      201,
    );
    const [row] = await rowsOf(contest._id, 'alice');
    expect(row.rulesAcceptedRevision).toBe(1);
    expect(row.rulesAcceptedAt).toBeInstanceOf(Date);
  });

  it('asks for acceptance on the first live join and not for a contest without rules', async () => {
    const withRules = await createContest(api, rules);
    const without = await createContest(api);
    await post('bob', withRules.key, 'join')
      .expect(400)
      .expect(errorCode('rules_not_accepted'));
    await post('bob', withRules.key, 'join', { acceptRules: true }).expect(201);
    await post('bob', without.key, 'join').expect(201);
    expect((await rowsOf(without._id, 'bob'))[0].rulesAcceptedAt).toBeNull();
  });

  it('does not ask when the rules are empty, whatever their revision', async () => {
    const contest = await createContest(api, { rules: '', rulesRevision: 2 });
    await post('carol', contest.key, 'join').expect(201);
    expect((await rowsOf(contest._id, 'carol'))[0].rulesAcceptedAt).toBeNull();
  });

  it('exempts spectating and re-entering, even after the rules were edited', async () => {
    const contest = await createContest(api, {
      ...rules,
      testers: [ids.tester],
      registrationStart: hoursFromNow(-2),
      registrationEnd: hoursFromNow(1),
    });
    const spectated = dataOf<{ virtual: number }>(
      await post('tester', contest.key, 'join').expect(201),
    );
    expect(spectated.virtual).toBe(-1);
    await post('dave', contest.key, 'register', { acceptRules: true }).expect(
      201,
    );
    await api.contests.updateOne(
      { _id: contest._id },
      { rules: 'New', rulesRevision: 2 },
    );
    await post('dave', contest.key, 'join').expect(201);
    const [row] = await rowsOf(contest._id, 'dave');
    expect(row.rulesAcceptedRevision).toBe(1);
  });

  it('asks again for every new virtual join and stores each revision', async () => {
    const contest = await createContest(api, {
      ...rules,
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
    });
    await post('alice', contest.key, 'join')
      .expect(400)
      .expect(errorCode('rules_not_accepted'));
    await post('alice', contest.key, 'join', { acceptRules: true }).expect(201);
    await api.contests.updateOne({ _id: contest._id }, { rulesRevision: 2 });
    await post('alice', contest.key, 'join')
      .expect(400)
      .expect(errorCode('rules_not_accepted'));
    await post('alice', contest.key, 'join', { acceptRules: true }).expect(201);
    const rows = await rowsOf(contest._id, 'alice');
    expect(rows.map((row) => [row.virtual, row.rulesAcceptedRevision])).toEqual(
      [
        [1, 1],
        [2, 2],
      ],
    );
  });

  it('shows who accepted which revision to the contest editor', async () => {
    const contest = await createContest(api, {
      ...rules,
      authors: [ids.editor],
    });
    await post('bob', contest.key, 'join', { acceptRules: true }).expect(201);
    const rows = dataOf<ParticipationResponse[]>(
      await authed(
        api.http().get(contestUrl(contest.key, '/participations')),
        sessions.editor,
      ).expect(200),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rulesAcceptedRevision: 1 });
    expect(rows[0].rulesAcceptedAt).not.toBeNull();
  });

  it('tells the participant which revision they accepted, on their own detail and in the join answer', async () => {
    type Accepted = {
      rulesAcceptedAt: string | null;
      rulesAcceptedRevision: number | null;
    };
    const liveOf = async (key: string): Promise<Accepted | null> =>
      dataOf<{ viewer: { liveParticipation: Accepted | null } }>(
        await authed(api.http().get(contestUrl(key)), sessions.carol).expect(
          200,
        ),
      ).viewer.liveParticipation;
    const withRules = await createContest(api, rules);
    const without = await createContest(api);
    const joined = dataOf<Accepted>(
      await post('carol', withRules.key, 'join', { acceptRules: true }).expect(
        201,
      ),
    );
    await post('carol', without.key, 'join').expect(201);
    const [row] = await rowsOf(withRules._id, 'carol');
    const accepted = {
      rulesAcceptedRevision: 1,
      rulesAcceptedAt: row.rulesAcceptedAt!.toISOString(),
    };
    expect(joined).toMatchObject(accepted);
    expect(await liveOf(withRules.key)).toMatchObject(accepted);
    expect(await liveOf(without.key)).toMatchObject({
      rulesAcceptedRevision: null,
      rulesAcceptedAt: null,
    });
    await api.contests.updateOne(
      { _id: withRules._id },
      { rules: 'New', rulesRevision: 2 },
    );
    expect(await liveOf(withRules.key)).toMatchObject(accepted);
  });
});
