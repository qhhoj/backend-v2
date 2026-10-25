import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { recordSubmissionEvents } from '@libs/judging/testing';
import { SPECTATE } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
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
import type { Catalog, TestSession } from './problem-fixtures';
import {
  bridgeCommands,
  clearBridgeCommands,
  dataOf,
} from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('submitting inside a contest', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const submit = (who: string, code: string) =>
    authed(
      api.http().post(`/api/internal/problems/${code}/submit`),
      sessions[who],
    ).send({ language: catalog.languages.cpp, source: 'int main() {}' });
  const idOf = (response: { body: unknown }) =>
    dataOf<{ id: string }>(response).id;
  const enter = async (who: string, contestId: string, extra = {}) => {
    const participation = await joinParticipation(
      api,
      contestId,
      users[who]._id,
      extra,
    );
    await makeCurrent(api, users[who]._id, participation._id);
    return participation;
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['bob', {}],
      ['carol', {}],
      ['dave', {}],
      ['erin', {}],
      ['tess', {}],
      ['spammer', { permissions: ['judge.spam_submission'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearBridgeCommands(api));

  it('submits a contest problem at contest priority with its contest row, and anything else normally', async () => {
    const inContest = await createProblem(api, catalog, {
      code: 'cp_one',
      isPublic: false,
    });
    await createProblem(api, catalog, { code: 'outside' });
    const lockedAfter = hoursFromNow(5);
    const contest = await createContest(api, {
      runPretestsOnly: true,
      lockedAfter,
      problems: [contestProblem(inContest._id, 0, { isPretested: true })],
    });
    const participation = await enter('alice', contest._id);
    const id = idOf(await submit('alice', 'cp_one').expect(201));
    expect(await api.submissions.findById(id).lean()).toMatchObject({
      status: 'QU',
      priority: 0,
      isPretested: true,
      lockedAfter,
    });
    expect(uuidStr((await api.submissions.findById(id).lean())!.contest!)).toBe(
      contest._id,
    );
    expect(await api.contestSubmissions.findById(id).lean()).toMatchObject({
      points: 0,
      isPretest: true,
    });
    expect(
      uuidStr(
        (await api.contestSubmissions.findById(id).lean())!.participation,
      ),
    ).toBe(participation._id);
    expect(await bridgeCommands(api)).toEqual([
      { type: 'judge', submissionIds: [id], judgeName: null, bannedJudges: [] },
    ]);
    const normal = idOf(await submit('alice', 'outside').expect(201));
    expect(await api.submissions.findById(normal).lean()).toMatchObject({
      priority: 1,
      contest: null,
      lockedAfter: null,
    });
    expect(await api.contestSubmissions.findById(normal).lean()).toBeNull();
  });

  it('refuses a spectator who is not contest staff (a contestant whose window ended) while the contest runs', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'cp_spectated',
      isPublic: false,
    });
    const running = await createContest(api, {
      problems: [contestProblem(problem._id, 0)],
    });
    await enter('dave', running._id, { virtual: SPECTATE });
    await submit('dave', 'cp_spectated')
      .expect(403)
      .expect(errorCode('spectator_cannot_submit'));
  });

  it('lets a tester spectating a running contest submit as a contest submission', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'cp_tested',
      isPublic: false,
    });
    const contest = await createContest(api, {
      testers: [users.tess._id],
      problems: [contestProblem(problem._id, 0)],
    });
    await enter('tess', contest._id, { virtual: SPECTATE });
    const id = idOf(await submit('tess', 'cp_tested').expect(201));
    expect(uuidStr((await api.submissions.findById(id).lean())!.contest!)).toBe(
      contest._id,
    );
    expect(await api.contestSubmissions.findById(id).lean()).not.toBeNull();
  });

  it('caps submissions per problem, not counting internal errors, for every user', async () => {
    const problem = await createProblem(api, catalog, { code: 'cp_capped' });
    const contest = await createContest(api, {
      problems: [contestProblem(problem._id, 0, { maxSubmissions: 2 })],
    });
    await enter('spammer', contest._id);
    const first = idOf(await submit('spammer', 'cp_capped').expect(201));
    await submit('spammer', 'cp_capped').expect(201);
    await submit('spammer', 'cp_capped')
      .expect(403)
      .expect(errorCode('contest_submission_limit'));
    await api.submissions.updateOne(
      { _id: first },
      { status: 'IE', result: 'IE' },
    );
    await submit('spammer', 'cp_capped').expect(201);
    await submit('spammer', 'cp_capped')
      .expect(403)
      .expect(errorCode('contest_submission_limit'));
  });

  it('never exceeds the cap under concurrent submits', async () => {
    const problem = await createProblem(api, catalog, { code: 'cp_race' });
    const contest = await createContest(api, {
      problems: [contestProblem(problem._id, 0, { maxSubmissions: 1 })],
    });
    const participation = await enter('spammer', contest._id);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => submit('spammer', 'cp_race')),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      await api.contestSubmissions.countDocuments({
        participation: participation._id,
      }),
    ).toBe(1);
  });

  it('checks the contest cap only while holding the per-user lock, and frees the lock after', async () => {
    const problem = await createProblem(api, catalog, { code: 'cp_lock' });
    const contest = await createContest(api, {
      problems: [contestProblem(problem._id, 0, { maxSubmissions: 1 })],
    });
    await enter('bob', contest._id);
    const redis = api.app.get<Redis>(REDIS);
    const lockKey = `submit-lock:user:${users.bob._id}`;
    await redis.set(lockKey, 'held-by-another-request', 'EX', 10);
    await submit('bob', 'cp_lock').expect(409).expect(errorCode('conflict'));
    await redis.del(lockKey);
    await submit('bob', 'cp_lock').expect(201);
    expect(await redis.exists(lockKey)).toBe(0);
    await redis.set(lockKey, 'held-by-another-request', 'EX', 10);
    await submit('bob', 'cp_lock').expect(409).expect(errorCode('conflict'));
    await redis.del(lockKey);
    await submit('bob', 'cp_lock')
      .expect(403)
      .expect(errorCode('contest_submission_limit'));
  });

  it('stores FSO submissions pending without judging, publishing or the unfinished limit', async () => {
    const problem = await createProblem(api, catalog, { code: 'cp_final' });
    const contest = await createContest(api, {
      formatName: 'final_submission',
      problems: [contestProblem(problem._id, 0, { maxSubmissions: 1 })],
    });
    await enter('carol', contest._id);
    const events = await recordSubmissionEvents(TEST_REDIS_URL);
    try {
      const ids: string[] = [];
      for (let count = 0; count < 4; count += 1)
        ids.push(idOf(await submit('carol', 'cp_final').expect(201)));
      for (const id of ids)
        expect((await api.submissions.findById(id).lean())!.status).toBe('PD');
      expect(await bridgeCommands(api)).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(
        events.events.filter((event) => ids.includes(event.submissionId)),
      ).toEqual([]);
    } finally {
      await events.stop();
    }
  });

  it('judges FSO submissions at once after the contest ended (virtual participants)', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'cp_final_late',
    });
    const contest = await createContest(api, {
      formatName: 'final_submission',
      startTime: hoursFromNow(-5),
      endTime: hoursFromNow(-1),
      problems: [contestProblem(problem._id, 0)],
    });
    await enter('carol', contest._id, { virtual: 1 });
    const id = idOf(await submit('carol', 'cp_final_late').expect(201));
    expect((await api.submissions.findById(id).lean())!.status).toBe('QU');
    expect((await bridgeCommands(api)).map((command) => command.type)).toEqual([
      'judge',
    ]);
  });

  it('judges on pretests only when the contest runs pretests only and the problem has them', async () => {
    const withPretests = await createProblem(api, catalog, {
      code: 'pt_with',
      isPublic: false,
    });
    const without = await createProblem(api, catalog, {
      code: 'pt_without',
      isPublic: false,
    });
    const problems = [
      contestProblem(withPretests._id, 0, { isPretested: true }),
      contestProblem(without._id, 1, { isPretested: false }),
    ];
    const pretestsContest = await createContest(api, {
      runPretestsOnly: true,
      problems,
    });
    await enter('spammer', pretestsContest._id);
    const flags = async (code: string) => {
      const id = idOf(await submit('spammer', code).expect(201));
      await api.submissions.updateOne({ _id: id }, { status: 'D' });
      return [
        (await api.submissions.findById(id).lean())!.isPretested,
        (await api.contestSubmissions.findById(id).lean())!.isPretest,
      ];
    };
    expect(await flags('pt_with')).toEqual([true, true]);
    expect(await flags('pt_without')).toEqual([false, false]);
    const fullContest = await createContest(api, {
      runPretestsOnly: false,
      problems,
    });
    await enter('spammer', fullContest._id);
    expect(await flags('pt_with')).toEqual([false, false]);
  });

  it('lets an FSO contestant submit while holding the unfinished limit of queued submissions', async () => {
    await createProblem(api, catalog, { code: 'fso_outside' });
    const inside = await createProblem(api, catalog, {
      code: 'fso_inside',
      isPublic: false,
    });
    await submit('erin', 'fso_outside').expect(201);
    await submit('erin', 'fso_outside').expect(201);
    await submit('erin', 'fso_outside').expect(429);
    const contest = await createContest(api, {
      formatName: 'final_submission',
      problems: [contestProblem(inside._id, 0)],
    });
    await enter('erin', contest._id);
    const id = idOf(await submit('erin', 'fso_inside').expect(201));
    expect((await api.submissions.findById(id).lean())!.status).toBe('PD');
  });
});
