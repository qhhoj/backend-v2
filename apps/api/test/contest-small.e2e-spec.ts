import { getQueueToken } from '@nestjs/bullmq';
import { createOrganization } from './organization-fixtures';
import type { Queue } from 'bullmq';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  finalJudgeJobId,
  CONTEST_RATING_QUEUE,
  CONTEST_EXPORT_QUEUE,
  contestExportJobId,
  contestExportPath,
  CONTEST_DATA_QUEUE,
  contestDataJobId,
  contestDataPath,
} from '@libs/contests';
import type {
  ContestFinalJudgeJob,
  ContestRatingJob,
  ContestExportJob,
  ContestDataJob,
} from '@libs/contests';
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
import { sha256 } from '@libs/auth';
import type { User } from '@libs/database';
import type { OfficialRankingResponse } from '../src/modules/contests/ranking/dto/official-ranking.dto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import type { ContestExportStatusResponse } from '../src/modules/contests/export/dto/contest-export.dto';
import type { ContestDataStatusResponse } from '../src/modules/contests/data/dto/contest-data.dto';

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

    it("judges on an editor's request once an FSO contest started", async () => {
      const upcoming = await createContest(api, {
        formatName: 'final_submission',
        authors: [editorId],
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
      });
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
      await request(upcoming.key, editor).expect(409);
      await request(other.key, editor).expect(409);
      await request(ended.key, plain).expect(403);
      await request(running.key, editor).expect(202);
      await request(ended.key, editor).expect(202);
      expect(
        (await queue.getJobs(['waiting'])).map((job) => job.data.contestId),
      ).toEqual(expect.arrayContaining([running._id, ended._id]));
      expect(await queue.getJobs(['waiting'])).toHaveLength(2);
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
        [
          'cloner',
          [
            'judge.clone_contest',
            'judge.edit_own_contest',
            'judge.create_private_contest',
            'judge.contest_access_code',
          ],
        ],
        ['plainCloner', ['judge.clone_contest', 'judge.edit_own_contest']],
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
      // The cloner administers it: a clone stays within the cloner's organizations.
      const organizationId = uuidStr(
        (
          await createOrganization(api, {
            slug: 'clonerorg',
            adminIds: [users.cloner._id],
          })
        )._id,
      );
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

    it('clones unrated, resetting each gated setting the cloner may not set', async () => {
      const source = await createContest(api, {
        authors: [users.plainCloner._id],
        isRated: true,
        rateAll: true,
        ratingFloor: 1000,
        ratingCeiling: 1500,
        isPrivate: true,
        privateContestants: [users.other._id],
        accessCodeHash: sha256('code'),
      });
      await clone('plainCloner', source.key, { key: 'plain_clone' }).expect(
        201,
      );
      const stored = (await api.contests
        .findOne({ key: 'plain_clone' })
        .lean())!;
      expect(stored).toMatchObject({
        isRated: false,
        rateAll: false,
        ratingFloor: null,
        ratingCeiling: null,
        isPrivate: false,
        privateContestants: [],
        accessCodeHash: null,
      });
      const long = await createContest(api, {
        authors: [users.plainCloner._id],
        endTime: hoursFromNow(20 * 24),
      });
      expect(
        issueCodesOf(
          await clone('plainCloner', long.key, { key: 'long_clone' }).expect(
            400,
          ),
        ),
      ).toEqual(['contest_too_long']);
    });

    it('moves the copy to a new start, keeping its length and registration window', async () => {
      const source = await createContest(api, {
        authors: [users.cloner._id],
        startTime: new Date('2026-10-16T03:40:00Z'),
        endTime: new Date('2026-10-16T07:40:00Z'),
        registrationEnd: new Date('2026-10-16T03:00:00Z'),
      });
      await clone('cloner', source.key, {
        key: 'next_week',
        startTime: '2026-10-23T12:40:00+07:00',
      }).expect(201);
      expect(
        await api.contests.findOne({ key: 'next_week' }).lean(),
      ).toMatchObject({
        startTime: new Date('2026-10-23T05:40:00Z'),
        endTime: new Date('2026-10-23T09:40:00Z'),
        registrationStart: null,
        registrationEnd: new Date('2026-10-23T05:00:00Z'),
      });
      await clone('cloner', source.key, {
        key: 'bad_start',
        startTime: 'next week',
      }).expect(400);
      expect(
        await api.contests.findOne({ key: source.key }).lean(),
      ).toMatchObject({ startTime: new Date('2026-10-16T03:40:00Z') });
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

describe('contest rating request', () => {
  let ratingQueue: Queue<ContestRatingJob>;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const roles = {
    rater: ['judge.contest_rating', 'judge.edit_own_contest'],
    author: ['judge.edit_own_contest'],
    outsider: ['judge.contest_rating'],
  };
  const endedContest = (authors: string[]) =>
    createContest(api, {
      authors,
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
  const rate = (who: string, key: string) =>
    authed(api.http().post(contestUrl(key, '/rate')), sessions[who]);

  beforeAll(async () => {
    await api.reset();
    ratingQueue = api.app.get(getQueueToken(CONTEST_RATING_QUEUE));
    for (const [name, permissions] of Object.entries(roles)) {
      users[name] = await createUserWith(api, name, { permissions });
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  beforeEach(() => ratingQueue.obliterate({ force: true }));

  it('queues a rating for an editor with judge.contest_rating once the contest ended', async () => {
    const contest = await endedContest([users.rater._id]);
    const response = await rate('rater', contest.key).expect(202);
    expect(dataOf(response)).toEqual({ queued: true });
    expect(
      (await ratingQueue.getJobs(['waiting'])).map((job) => job.data),
    ).toEqual([{ contestId: contest._id }]);
  });

  it('refuses to rate while the board is frozen, also after the end, until the freeze is set to 0', async () => {
    const contest = await createContest(api, {
      authors: [users.rater._id],
      formatName: 'icpc',
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
      frozenLastMinutes: 120,
    });
    await rate('rater', contest.key).expect(409).expect(errorCode('conflict'));
    expect(await ratingQueue.count()).toBe(0);
    await api.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 0 },
    );
    await rate('rater', contest.key).expect(202);
    expect(await ratingQueue.getWaitingCount()).toBe(1);
  });

  it('refuses without the permission, without edit rights and before the end', async () => {
    const ended = await endedContest([users.rater._id, users.author._id]);
    await rate('author', ended.key).expect(403).expect(errorCode('forbidden'));
    await rate('outsider', ended.key)
      .expect(403)
      .expect(errorCode('forbidden'));
    const running = await createContest(api, { authors: [users.rater._id] });
    await rate('rater', running.key).expect(409).expect(errorCode('conflict'));
    expect(await ratingQueue.count()).toBe(0);
  });
});

const issueCodes = ({ body }: { body: unknown }): string[] =>
  (body as { error: { issues: { code: string }[] } }).error.issues.map(
    (issue) => issue.code,
  );

describe('contest submissions export', () => {
  let queue: Queue<ContestExportJob>;
  let ended: { _id: string; key: string };
  let running: { _id: string; key: string };
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const request = (who: string, key: string) =>
    authed(api.http().post(contestUrl(key, '/export')), sessions[who]);
  const download = (who: string, key: string) =>
    authed(api.http().get(contestUrl(key, '/export/download')), sessions[who]);
  const statusOf = async (key: string) =>
    dataOf<ContestExportStatusResponse>(
      await authed(
        api.http().get(contestUrl(key, '/export')),
        sessions.editor,
      ).expect(200),
    );
  const zipFile = () => contestExportPath(api.contestDataRoot, ended._id);

  beforeAll(async () => {
    await api.reset();
    queue = api.app.get(getQueueToken(CONTEST_EXPORT_QUEUE));
    for (const [name, permissions] of [
      ['plain', []],
      ['editor', ['judge.edit_own_contest']],
    ] as const) {
      users[name] = await createUserWith(api, name, {
        permissions: [...permissions],
      });
      sessions[name] = await loginAs(api, users[name]._id);
    }
    const authors = [users.editor._id];
    ended = await createContest(api, {
      authors,
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    running = await createContest(api, { authors });
  });
  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await api.contests.updateOne(
      { _id: ended._id },
      { exportPreparedAt: null },
    );
    rmSync(zipFile(), { force: true });
  });

  it('queues an export for editors of an ended contest, once a day while a zip exists and three builds a day at most', async () => {
    await request('editor', running.key).expect(409);
    await request('editor', ended.key).expect(202);
    expect((await queue.getJob(contestExportJobId(ended._id)))!.data).toEqual({
      contestId: ended._id,
    });
    expect(issueCodes(await request('editor', ended.key).expect(409))).toEqual([
      'export_in_progress',
    ]);
    expect((await statusOf(ended.key)).state).toBe('preparing');
    await queue.obliterate({ force: true });
    writeFileSync(zipFile(), 'zip bytes');
    const limited = await request('editor', ended.key).expect(429);
    expect(issueCodes(limited)).toEqual(['export_rate_limited']);
    rmSync(zipFile());
    await request('editor', ended.key).expect(202);
    // A failed build leaves no zip either: the daily cap still holds.
    await queue.obliterate({ force: true });
    await request('editor', ended.key).expect(202);
    await queue.obliterate({ force: true });
    expect(issueCodes(await request('editor', ended.key).expect(429))).toEqual([
      'export_rate_limited',
    ]);
  });

  it('refuses everyone but editors, each refusal carrying an issue code', async () => {
    const asked = await request('plain', ended.key).expect(403);
    expect(issueCodes(asked)).toEqual(['forbidden']);
    writeFileSync(zipFile(), 'zip bytes');
    const fetched = await download('plain', ended.key).expect(403);
    expect(issueCodes(fetched)).toEqual(['forbidden']);
    expect(
      issueCodes(await request('editor', running.key).expect(409)),
    ).toEqual(['contest_not_ended']);
    const status = await authed(
      api.http().get(contestUrl(ended.key, '/export')),
      sessions.plain,
    ).expect(403);
    expect(issueCodes(status)).toEqual(['forbidden']);
  });

  it('serves the zip as an uncached attachment to editors only, 404 while none exists', async () => {
    const missing = await download('editor', ended.key).expect(404);
    expect(issueCodes(missing)).toEqual(['export_not_prepared']);
    writeFileSync(zipFile(), 'zip bytes');
    const response = await download('editor', ended.key).expect(200);
    expect(response.headers['content-type']).toMatch(/application\/zip/);
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${ended.key}-export.zip"`,
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(
      existsSync(contestExportPath(api.contestDataRoot, running._id)),
    ).toBe(false);
  });
});

describe('contest data download', () => {
  let dataQueue: Queue<ContestDataJob>;
  let ended: { _id: string; key: string };
  let running: { _id: string; key: string };
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const prepare = (who: string, key: string, body: object = {}) =>
    authed(api.http().post(contestUrl(key, '/data')).send(body), sessions[who]);
  const statusOf = async (key: string) =>
    dataOf<ContestDataStatusResponse>(
      await authed(
        api.http().get(contestUrl(key, '/data')),
        sessions.editor,
      ).expect(200),
    );
  const download = (who: string, key: string) =>
    authed(api.http().get(contestUrl(key, '/data/download')), sessions[who])
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          done(
            null,
            response.headers['content-type']?.includes('json')
              ? JSON.parse(body.toString())
              : body,
          );
        });
      });
  const zipFile = () => contestDataPath(api.contestDataRoot, ended._id);

  beforeAll(async () => {
    await api.reset();
    dataQueue = api.app.get(getQueueToken(CONTEST_DATA_QUEUE));
    for (const [name, permissions] of [
      ['plain', []],
      ['editor', ['judge.edit_own_contest']],
    ] as const) {
      users[name] = await createUserWith(api, name, {
        permissions: [...permissions],
      });
      sessions[name] = await loginAs(api, users[name]._id);
    }
    const authors = [users.editor._id];
    ended = await createContest(api, {
      authors,
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    running = await createContest(api, { authors });
  });
  beforeEach(async () => {
    await dataQueue.obliterate({ force: true });
    await api.contests.updateOne({ _id: ended._id }, { dataPreparedAt: null });
    rmSync(zipFile(), { force: true });
  });

  it('prepares for editors of an ended contest, once a day while a zip exists', async () => {
    await prepare('plain', ended.key).expect(403);
    await prepare('editor', running.key)
      .expect(409)
      .expect(errorCode('conflict'));
    await prepare('editor', ended.key, { problemGlob: '../x' }).expect(400);
    await prepare('editor', ended.key, { results: ['NOPE'] }).expect(400);
    await prepare('editor', ended.key, {
      problemGlob: 's*',
      results: ['AC'],
    }).expect(202);
    expect((await dataQueue.getJob(contestDataJobId(ended._id)))!.data).toEqual(
      { contestId: ended._id, problemGlob: 's*', results: ['AC'] },
    );
    await prepare('editor', ended.key).expect(409); // still preparing
    expect((await statusOf(ended.key)).state).toBe('preparing');
    await dataQueue.obliterate({ force: true });
    writeFileSync(zipFile(), 'zip bytes');
    await prepare('editor', ended.key)
      .expect(429)
      .expect(errorCode('rate_limited'));
    rmSync(zipFile());
    await prepare('editor', ended.key).expect(202); // the zip is gone: allowed again
  });

  it('downloads the zip as an attachment, and 404 without one', async () => {
    writeFileSync(zipFile(), 'zip bytes');
    const response = await download('editor', ended.key).expect(200);
    expect(response.headers).toMatchObject({
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${ended.key}-data.zip"`,
      'x-content-type-options': 'nosniff',
    });
    expect((response.body as Buffer).toString()).toBe('zip bytes');
    rmSync(zipFile());
    await download('editor', ended.key)
      .expect(404)
      .expect(errorCode('not_found'));
  });

  it('serves status and download to editors only, once the contest has ended', async () => {
    writeFileSync(zipFile(), 'zip bytes');
    await download('plain', ended.key).expect(403);
    await authed(
      api.http().get(contestUrl(ended.key, '/data')),
      sessions.plain,
    ).expect(403);
    await api.http().get(contestUrl(ended.key, '/data/download')).expect(401);
    await download('editor', running.key).expect(409);
    await authed(
      api.http().get(contestUrl(running.key, '/data')),
      sessions.editor,
    ).expect(409);
    expect(existsSync(zipFile())).toBe(true);
  });
});
