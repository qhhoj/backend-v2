import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_FINAL_JUDGE_QUEUE, finalJudgeJobId } from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { uuidStr, newId } from '@libs/database';
import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
import {
  contestUrl,
  createContest,
  hoursFromNow,
  contestProblem,
} from './contest-fixtures';
import {
  authed,
  createUserWith,
  loginAs,
  createProblem,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession, Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest, errorCode } from './setup';
import type { ApiTest } from './setup';
import { randomUUID } from 'node:crypto';
import { sha256 } from '@libs/auth';
import type { User } from '@libs/database';
import type { OfficialRankingResponse } from '../src/modules/contests/ranking/dto/official-ranking.dto';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from contest-final-judge.e2e-spec.ts
{
  describe('FSO final judging in the api', () => {
    beforeAll(() => api.reset());
    let queue: Queue<ContestFinalJudgeJob>;
    let editor: TestSession;
    let plain: TestSession;
    let editorId: string;
    const jobIds = async () =>
      (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);

    beforeAll(async () => {
      queue = api.app.get(getQueueToken(CONTEST_FINAL_JUDGE_QUEUE));
      editorId = (
        await createUserWith(api, 'fso_editor', {
          permissions: ['judge.add_contest', 'judge.edit_own_contest'],
        })
      )._id;
      editor = await loginAs(api, editorId);
      plain = await loginAs(api, (await createUserWith(api, 'fso_plain'))._id);
    });
    beforeEach(() => queue.obliterate({ force: true }));

    it('schedules judging at the end on create and moves it with an endTime edit', async () => {
      const endTime = hoursFromNow(3);
      const created = dataOf<ContestDetailResponse>(
        await authed(api.http().post('/api/internal/contests'), editor)
          .send({
            key: 'fso_round',
            name: 'FSO',
            startTime: hoursFromNow(1).toISOString(),
            endTime: endTime.toISOString(),
            formatName: 'final_submission',
          })
          .expect(201),
      );
      const id = uuidStr(
        (await api.contests.findOne({ key: created.key }).lean())!._id,
      );
      expect(await jobIds()).toEqual([finalJudgeJobId(id, endTime)]);
      const later = hoursFromNow(4);
      await authed(api.http().patch(contestUrl('fso_round')), editor)
        .send({ endTime: later.toISOString() })
        .expect(200);
      expect(await jobIds()).toEqual([finalJudgeJobId(id, later)]);
      await authed(api.http().patch(contestUrl('fso_round')), editor)
        .send({ formatConfig: { autoJudge: false } })
        .expect(200);
      expect(await jobIds()).toEqual([]);
    });

    it("judges on an editor's request once an FSO contest ended", async () => {
      const running = await createContest(api, {
        formatName: 'final_submission',
        authors: [editorId],
      });
      const ended = await createContest(api, {
        formatName: 'final_submission',
        authors: [editorId],
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      const other = await createContest(api, {
        authors: [editorId],
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      const request = (key: string, session: TestSession) =>
        authed(api.http().post(contestUrl(key, '/judge-final')), session);
      await request(running.key, editor).expect(409);
      await request(other.key, editor).expect(409);
      await request(ended.key, plain).expect(403);
      await request(ended.key, editor).expect(202);
      expect((await queue.getJobs(['waiting'])).map((job) => job.data)).toEqual(
        [{ contestId: ended._id, manual: true }],
      );
    });
  });
}

// from contest-managed-by.e2e-spec.ts
{
  describe('client-managed contests and clones', () => {
    beforeAll(() => api.reset());
    beforeAll(async () => {});

    it('does not carry the managing client over to a human clone', async () => {
      const cloner = await createUserWith(api, 'managedcloner', {
        permissions: ['judge.clone_contest', 'judge.edit_own_contest'],
      });
      const source = await createContest(api, {
        authors: [cloner._id],
        managedBy: newId(),
      });
      await authed(
        api.http().post(contestUrl(source.key, '/clone')),
        await loginAs(api, cloner._id),
      )
        .send({ key: `${source.key}_copy` })
        .expect(201);
      const copy = await api.contests
        .findOne({ key: `${source.key}_copy` })
        .lean();
      expect(copy?.managedBy).toBeNull();
      expect(
        (await api.contests.findById(source._id).lean())?.managedBy,
      ).not.toBeNull();
    });
  });
}

// from contest-problem-limits.e2e-spec.ts
{
  describe('problem limits in the contest overview', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let alice: TestSession;
    let editor: TestSession;
    let editorId: string;
    const problemsOf = async (key: string, session?: TestSession) => {
      const request = api.http().get(contestUrl(key));
      const response = await (
        session ? authed(request, session) : request
      ).expect(200);
      return dataOf<ContestDetailResponse>(response).problems;
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      alice = await loginAs(
        api,
        (await createUserWith(api, 'limits_alice'))._id,
      );
      editorId = (
        await createUserWith(api, 'limits_editor', {
          permissions: ['judge.edit_own_contest'],
        })
      )._id;
      editor = await loginAs(api, editorId);
    });

    it('shows the limits of every contest problem to a participant, private problems included', async () => {
      const hidden = await createProblem(api, catalog, {
        code: 'lim_private',
        isPublic: false,
        timeLimit: 2,
        memoryLimit: 65536,
      });
      const open = await createProblem(api, catalog, {
        code: 'lim_public',
        timeLimit: 1,
        memoryLimit: 262144,
      });
      const contest = await createContest(api, {
        problems: [contestProblem(hidden._id, 0), contestProblem(open._id, 1)],
      });
      await authed(api.http().post(contestUrl(contest.key, '/join')), alice)
        .send({})
        .expect(201);
      const problems = (await problemsOf(contest.key, alice))!;
      expect(
        problems.map((row) => [row.code, row.timeLimit, row.memoryLimit]),
      ).toEqual([
        ['lim_private', 2, 65536],
        ['lim_public', 1, 262144],
      ]);
    });

    it('gives a signed-out visitor of an ended contest the limits of public problems only', async () => {
      const hidden = await createProblem(api, catalog, {
        code: 'end_private',
        isPublic: false,
      });
      const open = await createProblem(api, catalog, {
        code: 'end_public',
        timeLimit: 3,
      });
      const contest = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        problems: [contestProblem(hidden._id, 0), contestProblem(open._id, 1)],
      });
      const problems = (await problemsOf(contest.key))!;
      expect(problems.map((row) => [row.code, row.timeLimit !== null])).toEqual(
        [
          ['end_private', false],
          ['end_public', true],
        ],
      );
      expect(problems[0].memoryLimit).toBeNull();
    });

    it('keeps a limit null for a contest editor who cannot see the private problem', async () => {
      const hidden = await createProblem(api, catalog, {
        code: 'edit_private',
        isPublic: false,
      });
      const contest = await createContest(api, {
        authors: [editorId],
        problems: [contestProblem(hidden._id, 0)],
      });
      const [row] = (await problemsOf(contest.key, editor))!;
      expect(row).toMatchObject({
        code: 'edit_private',
        timeLimit: null,
        memoryLimit: null,
      });
    });

    it('leaves out a contest problem whose document is gone instead of failing', async () => {
      const open = await createProblem(api, catalog, { code: 'gone_public' });
      const contest = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        problems: [contestProblem(newId(), 0), contestProblem(open._id, 1)],
      });
      expect((await problemsOf(contest.key))!.map((row) => row.code)).toEqual([
        'gone_public',
      ]);
    });
  });
}

// from contest-clone.e2e-spec.ts
{
  const issueCodesOf = ({ body }: { body: unknown }) =>
    (body as { error: { issues: { code: string }[] } }).error.issues.map(
      (issue) => issue.code,
    );

  describe('contest clone', () => {
    beforeAll(() => api.reset());
    let finalJudges: Queue<ContestFinalJudgeJob>;
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const problems: Record<string, { _id: string }> = {};
    const clone = (who: string, key: string, body: object) =>
      authed(api.http().post(contestUrl(key, '/clone')), sessions[who]).send(
        body,
      );

    beforeAll(async () => {
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
    beforeEach(() => finalJudges.obliterate({ force: true }));

    it('clones a contest hidden, with its problems and settings, the cloner as the only author', async () => {
      const organizationId = randomUUID();
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
        rankingAccessCodeHash: sha256('ranking'),
        rateExclude: [users.other._id],
        bannedJudges: ['judge-a'],
        organizations: [organizationId],
        privateContestants: [users.other._id],
        lockedAfter: hoursFromNow(1),
        userCount: 5,
        virtualCount: 2,
        dataPreparedAt: new Date(),
        balloons: true,
        balloonStaff: [users.other._id],
        exportPreparedAt: new Date(),
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
        balloons: true,
        balloonStaff: [],
        exportPreparedAt: null,
        formatName: 'icpc',
        formatConfig: { penalty: 10 },
        accessCodeHash: sha256('code'),
        rankingAccessCodeHash: sha256('ranking'),
        tags: ['dp'],
        rateExclude: [],
        bannedJudges: [],
      });
      expect(stored.organizations.map(uuidStr)).toEqual([organizationId]);
      expect(stored.privateContestants.map(uuidStr)).toEqual([users.other._id]);
      expect(uuidStr(stored._id)).not.toBe(source._id);
      expect(
        [
          stored.authors,
          stored.curators,
          stored.testers,
          stored.bannedUsers,
        ].map((ids) => ids.map(uuidStr)),
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
      const taken = await clone('cloner', source.key, { key: source.key })
        .expect(409)
        .expect(errorCode('conflict'));
      expect(issueCodesOf(taken)).toEqual(['key_taken']);
      const reserved = await clone('cloner', source.key, { key: 'current' })
        .expect(400)
        .expect(errorCode('validation_failed'));
      expect(issueCodesOf(reserved)).toEqual(['key_reserved']);
      await clone('cloner', source.key, { key: 'Bad-Key' })
        .expect(400)
        .expect(errorCode('validation_failed'));
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
}

// from contest-official-ranking.e2e-spec.ts
{
  const CSV = [
    'Username,Full Name,School,Points,A,B',
    'ann,Ann,X,50,50,',
    'bob,"Bob, Jr.",Y,150,100,50',
  ].join('\r\n');

  describe('contest official ranking', () => {
    beforeAll(() => api.reset());
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const put = (role: string, key: string, body: Record<string, unknown>) =>
      authed(
        api.http().put(contestUrl(key, '/official-ranking')),
        sessions[role],
      ).send(body);
    const show = async (key: string) =>
      dataOf<OfficialRankingResponse>(
        await api.http().get(contestUrl(key, '/official-ranking')).expect(200),
      );

    beforeAll(async () => {
      const roles: Array<[string, Partial<User>]> = [
        ['editor', { permissions: ['judge.edit_own_contest'] }],
        ['plain', {}],
      ];
      for (const [name, extra] of roles) {
        users[name] = await createUserWith(api, name, extra);
        sessions[name] = await loginAs(api, users[name]._id);
      }
    });

    it('stores a parsed table for editors and shows it ranked to viewers of the scoreboard', async () => {
      const contest = await createContest(api, { authors: [users.editor._id] });
      await put('plain', contest.key, { csv: CSV }).expect(403);
      await put('editor', contest.key, { csv: CSV }).expect(200);
      const shown = await show(contest.key);
      expect(shown.url).toBeNull();
      expect(shown.problems).toEqual(['A', 'B']);
      expect(
        shown.rows.map((row) => [row.rank, row.username, row.totalScore]),
      ).toEqual([
        [1, 'bob', 150],
        [2, 'ann', 50],
      ]);
      expect(shown.rows[0].scores).toEqual([100, 50]);
    });

    it('replaces the table on a second upload', async () => {
      const contest = await createContest(api, { authors: [users.editor._id] });
      await put('editor', contest.key, { csv: CSV }).expect(200);
      await put('editor', contest.key, {
        csv: 'Username,Full Name,X,Points\ncy,Cy,x,7',
      }).expect(200);
      const shown = await show(contest.key);
      expect(shown.problems).toEqual([]);
      expect(shown.rows.map((row) => row.username)).toEqual(['cy']);
    });

    it('keeps a URL as given and refuses other schemes', async () => {
      const contest = await createContest(api, { authors: [users.editor._id] });
      await put('editor', contest.key, {
        url: 'https://cms.example.org/ranking',
      }).expect(200);
      const shown = await show(contest.key);
      expect(shown.url).toBe('https://cms.example.org/ranking');
      expect(shown.rows).toEqual([]);
      await put('editor', contest.key, { url: 'javascript:alert(1)' })
        .expect(400)
        .expect(errorCode('validation_failed'));
      await put('editor', contest.key, {
        csv: CSV,
        url: 'https://cms.example.org',
      }).expect(400);
      await put('editor', contest.key, {}).expect(400);
      expect((await show(contest.key)).url).toBe(
        'https://cms.example.org/ranking',
      );
    });

    it('answers a bad CSV with 400 on the csv field and an oversized body before parsing', async () => {
      const contest = await createContest(api, { authors: [users.editor._id] });
      const response = await put('editor', contest.key, {
        csv: 'Username,Full Name,X,Points\na,A,x,nan',
      }).expect(400);
      expect(
        Object.keys(
          (response.body as { error: { fields: object } }).error.fields,
        ),
      ).toEqual(['csv']);
      await put('editor', contest.key, { csv: 'x'.repeat(1_048_577) })
        .expect(400)
        .expect(errorCode('validation_failed'));
      await api
        .http()
        .get(contestUrl(contest.key, '/official-ranking'))
        .expect(404);
    });

    it('hides the table from viewers who cannot see their own scoreboard, and answers 404 once deleted', async () => {
      const hidden = await createContest(api, {
        authors: [users.editor._id],
        scoreboardVisibility: 'H',
      });
      await put('editor', hidden.key, { csv: CSV }).expect(200);
      await api
        .http()
        .get(contestUrl(hidden.key, '/official-ranking'))
        .expect(403);
      await authed(
        api.http().get(contestUrl(hidden.key, '/official-ranking')),
        sessions.editor,
      ).expect(200);
      await authed(
        api.http().delete(contestUrl(hidden.key, '/official-ranking')),
        sessions.plain,
      ).expect(403);
      await authed(
        api.http().delete(contestUrl(hidden.key, '/official-ranking')),
        sessions.editor,
      ).expect(204);
      await authed(
        api.http().get(contestUrl(hidden.key, '/official-ranking')),
        sessions.editor,
      ).expect(404);
    });
  });
}
