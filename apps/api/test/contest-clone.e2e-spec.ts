import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { sha256 } from '@libs/auth';
import { CONTEST_FINAL_JUDGE_QUEUE, finalJudgeJobId } from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestDetailResponse } from '../src/modules/contests/dto/contest-detail.response';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
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
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest clone', () => {
  let api: ApiTest;
  let finalJudges: Queue<ContestFinalJudgeJob>;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Record<string, { _id: string }> = {};
  const clone = (who: string, key: string, body: object) =>
    authed(api.http().post(contestUrl(key, '/clone')), sessions[who]).send(
      body,
    );

  beforeAll(async () => {
    api = await setupApiTest();
    finalJudges = api.app.get(getQueueToken(CONTEST_FINAL_JUDGE_QUEUE));
    for (const [name, permissions] of [
      ['cloner', ['judge.clone_contest', 'judge.edit_own_contest']],
      ['editorOnly', ['judge.edit_own_contest']],
      ['cloneOutsider', ['judge.clone_contest']],
      ['other', []],
    ] as const) {
      users[name] = await createUserWith(api, name, {
        permissions: [...permissions],
      });
      sessions[name] = await loginAs(api, users[name]._id);
    }
    const catalog = await seedCatalog(api);
    problems.one = await createProblem(api, catalog, { code: 'cloneone' });
    problems.two = await createProblem(api, catalog, { code: 'clonetwo' });
  });
  afterAll(() => api.teardown());
  beforeEach(() => finalJudges.obliterate({ force: true }));

  it('clones a contest hidden, with its problems and settings, the cloner as the only author', async () => {
    const source = await createContest(api, {
      authors: [users.cloner._id, users.other._id],
      curators: [users.other._id],
      testers: [users.other._id],
      bannedUsers: [users.other._id],
      tags: ['dp'],
      viewContestScoreboard: [users.other._id],
      isVisible: true,
      formatName: 'icpc',
      formatConfig: { penalty: 10 },
      accessCodeHash: sha256('code'),
      lockedAfter: hoursFromNow(1),
      userCount: 5,
      virtualCount: 2,
      dataPreparedAt: new Date(),
      problems: [
        contestProblem(problems.one._id, 0, { points: 7 }),
        contestProblem(problems.two._id, 1),
      ],
    });
    await api.announcements.create({
      contest: source._id,
      title: 'Old',
      description: '',
    });
    const cloned = dataOf<ContestDetailResponse>(
      await clone('cloner', source.key, { key: 'cloned_round' }).expect(201),
    );
    const stored = (await api.contests
      .findOne({ key: 'cloned_round' })
      .lean())!;
    expect(stored).toMatchObject({
      isVisible: false,
      userCount: 0,
      virtualCount: 0,
      lockedAfter: null,
      dataPreparedAt: null,
      formatName: 'icpc',
      formatConfig: { penalty: 10 },
      accessCodeHash: sha256('code'),
      tags: ['dp'],
    });
    expect(uuidStr(stored._id)).not.toBe(source._id);
    expect(
      [stored.authors, stored.curators, stored.testers, stored.bannedUsers].map(
        (ids) => ids.map(uuidStr),
      ),
    ).toEqual([[users.cloner._id], [], [], []]);
    expect(stored.viewContestScoreboard.map(uuidStr)).toEqual([
      users.other._id,
    ]);
    expect(
      stored.problems.map((entry) => [
        uuidStr(entry.problem),
        entry.points,
        entry.order,
      ]),
    ).toEqual([
      [problems.one._id, 7, 0],
      [problems.two._id, 100, 1],
    ]);
    expect(cloned.key).toBe('cloned_round');
    expect(
      await api.announcements.countDocuments({ contest: stored._id }),
    ).toBe(0);
    // The source is untouched.
    expect(
      await api.contests.findOne({ key: source.key }).lean(),
    ).toMatchObject({ isVisible: true, userCount: 5 });
  });

  it('needs judge.clone_contest and edit rights, a free key and not a reserved one', async () => {
    const source = await createContest(api, {
      authors: [users.cloner._id, users.editorOnly._id],
    });
    await clone('editorOnly', source.key, { key: 'x_1' }).expect(403);
    await clone('cloneOutsider', source.key, { key: 'x_2' }).expect(403);
    await clone('cloner', source.key, { key: source.key })
      .expect(409)
      .expect(errorCode('conflict'));
    await clone('cloner', source.key, { key: 'current' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await clone('cloner', source.key, { key: 'Bad-Key' }).expect(400);
    expect(await api.contests.countDocuments({ key: /^x_/ })).toBe(0);
  });

  it('schedules final judging for a cloned final-submission contest', async () => {
    const fso = await createContest(api, {
      authors: [users.cloner._id],
      formatName: 'final_submission',
      formatConfig: {},
      endTime: hoursFromNow(5),
    });
    await clone('cloner', fso.key, { key: 'fso_clone' }).expect(201);
    const cloned = (await api.contests.findOne({ key: 'fso_clone' }).lean())!;
    expect(
      await finalJudges.getJob(
        finalJudgeJobId(uuidStr(cloned._id), cloned.endTime),
      ),
    ).toBeDefined();
  });
});
