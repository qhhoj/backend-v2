import { getQueueToken } from '@nestjs/bullmq';

import { Logger } from '@nestjs/common';

import type { Queue } from 'bullmq';

import {
  CONTEST_EXPORT_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_PUBLISH_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
  enqueueContestRating,
  enqueueContestRescore,
  requestFinalJudge,
  reschedulePublish,
} from '@libs/contests';

import type {
  ContestExportJob,
  ContestFinalJudgeJob,
  ContestPublishJob,
  ContestRatingJob,
  ContestReplayJob,
  ContestRescoreJob,
} from '@libs/contests';

import type { ContestActionsResponse } from '../src/modules/contests/editing/dto/contest-actions.response';

import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';

import {
  contestUrl,
  createContest,
  hoursFromNow,
  clearRateLimits,
  contestProblem,
  joinParticipation,
} from './contest-fixtures';

import {
  authed,
  createUserWith,
  loginAs,
  createProblem,
  seedCatalog,
} from './problem-fixtures';

import type { TestSession, Catalog } from './problem-fixtures';

import { dataOf, seedSubmission } from './submission-fixtures';

import { errorCode, setupApiTest, sessionCookie, TEST_ENV } from './setup';

import type { ApiTest } from './setup';

import { NOTIFICATION_FANOUT_QUEUE } from '@libs/community';

import type { NotificationFanoutJob } from '@libs/community';

import type { AnnouncementResponse } from '../src/modules/contests/announcements/dto/announcement.response';

import type { SubmissionResult, User, Contest } from '@libs/database';

import type { ContestStatsResponse } from '../src/modules/contests/stats/dto/contest-stats.response';

import type { BalloonResponse } from '../src/modules/contests/balloons/dto/balloons.dto';

import { generateApiToken, sha256 } from '@libs/auth';

import { FeedAuthService } from '../src/modules/contests/feed/feed-auth.service';

import type {
  FeedKeyStatusResponse,
  MintedFeedKeyResponse,
} from '../src/modules/contests/feed/dto/feed-key.dto';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from contest-actions-status.e2e-spec.ts
{
  describe('contest action status', () => {
    beforeAll(() => api.reset());
    let rescores: Queue<ContestRescoreJob>;
    let finalJudges: Queue<ContestFinalJudgeJob>;
    let ratings: Queue<ContestRatingJob>;
    let publishes: Queue<ContestPublishJob>;
    let replays: Queue<ContestReplayJob>;
    let exports: Queue<ContestExportJob>;
    let editor: TestSession;
    let plain: TestSession;
    let editorId: string;

    const statusOf = async (
      key: string,
      session: TestSession = editor,
    ): Promise<ContestActionsResponse> =>
      dataOf<ContestActionsResponse>(
        await authed(
          api.http().get(contestUrl(key, '/actions')),
          session,
        ).expect(200),
      );
    const idle: ContestActionsResponse = {
      rescore: 'idle',
      judgeFinal: 'idle',
      rate: 'idle',
      publish: 'idle',
      replay: 'idle',
      export: 'idle',
      autoPublish: null,
      pendingCount: 0,
    };

    beforeAll(async () => {
      rescores = api.app.get(getQueueToken(CONTEST_RESCORE_QUEUE));
      finalJudges = api.app.get(getQueueToken(CONTEST_FINAL_JUDGE_QUEUE));
      ratings = api.app.get(getQueueToken(CONTEST_RATING_QUEUE));
      publishes = api.app.get(getQueueToken(CONTEST_PUBLISH_QUEUE));
      replays = api.app.get(getQueueToken(CONTEST_REPLAY_QUEUE));
      exports = api.app.get(getQueueToken(CONTEST_EXPORT_QUEUE));
      editorId = (
        await createUserWith(api, 'actions_editor', {
          permissions: ['judge.add_contest', 'judge.edit_own_contest'],
        })
      )._id;
      editor = await loginAs(api, editorId);
      plain = await loginAs(
        api,
        (await createUserWith(api, 'actions_plain'))._id,
      );
    });
    beforeEach(async () => {
      await rescores.obliterate({ force: true });
      await finalJudges.obliterate({ force: true });
      await ratings.obliterate({ force: true });
      await publishes.obliterate({ force: true });
      await replays.obliterate({ force: true });
      await exports.obliterate({ force: true });
    });

    it('reports a rescore queued while its request waits', async () => {
      const contest = await createContest(api, { authors: [editorId] });
      await enqueueContestRescore(rescores, contest._id);
      expect(await statusOf(contest.key)).toEqual({
        ...idle,
        rescore: 'queued',
      });
    });

    it('ignores the automatic final judging scheduled for the end', async () => {
      const created = dataOf<ContestDetailResponse>(
        await authed(api.http().post('/api/internal/contests'), editor)
          .send({
            key: 'actions_fso',
            name: 'FSO',
            startTime: hoursFromNow(1).toISOString(),
            endTime: hoursFromNow(3).toISOString(),
            formatName: 'final_submission',
          })
          .expect(201),
      );
      expect((await finalJudges.getJobs(['delayed'])).length).toBe(1);
      expect(await statusOf(created.key)).toEqual(idle);
    });

    it('reports the automatic publish queued once it is scheduled for the end', async () => {
      const contest = await createContest(api, {
        authors: [editorId],
        publishAfterEnd: true,
      });
      await reschedulePublish(
        publishes,
        {
          previous: null,
          next: {
            id: contest._id,
            endTime: contest.endTime,
            publishAfterEnd: true,
          },
        },
        new Logger('spec'),
      );
      expect(await statusOf(contest.key)).toEqual({
        ...idle,
        publish: 'queued',
      });
    });

    it('ignores requests queued for another contest', async () => {
      const contest = await createContest(api, { authors: [editorId] });
      const other = await createContest(api, { authors: [editorId] });
      await enqueueContestRescore(rescores, other._id);
      await enqueueContestRating(ratings, other._id);
      await requestFinalJudge(finalJudges, other._id);
      expect(await statusOf(contest.key)).toEqual(idle);
    });

    it('refuses the status to a user who cannot edit the contest', async () => {
      const contest = await createContest(api, { authors: [editorId] });
      await authed(api.http().get(contestUrl(contest.key, '/actions')), plain)
        .expect(403)
        .expect(errorCode('forbidden'));
    });
  });
}

// from contest-announcement-fanout.e2e-spec.ts
{
  describe('contest announcements enqueue the notification fan-out', () => {
    beforeAll(() => api.reset());
    let queue: Queue<NotificationFanoutJob>;
    let editor: { id: string; session: TestSession };
    const post = (key: string, suffix = '') =>
      authed(
        api.http().post(contestUrl(key, `/announcements${suffix}`)),
        editor.session,
      );
    const waiting = async () =>
      (await queue.getJobs(['waiting', 'delayed'])).map((job) => job.data);

    beforeAll(async () => {
      queue = api.app.get(getQueueToken(NOTIFICATION_FANOUT_QUEUE));
      const user = await createUserWith(api, 'editor', {
        permissions: ['judge.edit_own_contest'],
      });
      editor = { id: user._id, session: await loginAs(api, user._id) };
    });
    beforeEach(async () => {
      await queue.obliterate({ force: true });
      await clearRateLimits(api);
    });

    it('queues one fan-out per push, for a create and again for a resend', async () => {
      const contest = await createContest(api, {
        authors: [editor.id],
        pushAnnouncements: true,
      });
      const created = dataOf<AnnouncementResponse>(
        await post(contest.key)
          .send({ title: 'T', description: 'x' })
          .expect(201),
      );
      expect(await waiting()).toEqual([{ announcementId: created.id }]);
      await post(contest.key, `/${created.id}/resend`).expect(204);
      expect(await waiting()).toHaveLength(2);
    });

    it('queues nothing when the contest does not push, and nothing for a delete', async () => {
      const quiet = await createContest(api, { authors: [editor.id] });
      await post(quiet.key).send({ title: 'T', description: 'x' }).expect(201);
      expect(await waiting()).toEqual([]);
      const loud = await createContest(api, {
        authors: [editor.id],
        pushAnnouncements: true,
      });
      const created = dataOf<AnnouncementResponse>(
        await post(loud.key).send({ title: 'T', description: 'x' }).expect(201),
      );
      await queue.obliterate({ force: true });
      await authed(
        api.http().delete(contestUrl(loud.key, `/announcements/${created.id}`)),
        editor.session,
      ).expect(204);
      expect(await waiting()).toEqual([]);
    });
  });
}

// from contest-stats.e2e-spec.ts
{
  describe('contest stats', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const problems: Record<string, { _id: string }> = {};

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const roles: Array<[string, Partial<User>]> = [
        ['alice', {}],
        ['editor', { permissions: ['judge.edit_own_contest'] }],
      ];
      for (const [name, extra] of roles) {
        users[name] = await createUserWith(api, name, extra);
        sessions[name] = await loginAs(api, users[name]._id);
      }
      for (const code of ['alpha', 'beta'])
        problems[code] = await createProblem(api, catalog, { code });
    });

    const stats = async (key: string, who?: string) =>
      dataOf<ContestStatsResponse>(
        await (
          who
            ? authed(api.http().get(contestUrl(key, '/stats')), sessions[who])
            : api.http().get(contestUrl(key, '/stats'))
        ).expect(200),
      );

    it('counts results per problem and per language after the start', async () => {
      const contest = await createContest(api, {
        startTime: hoursFromNow(-3),
        endTime: hoursFromNow(-1),
        problems: [
          contestProblem(problems.alpha._id, 0),
          contestProblem(problems.beta._id, 1),
        ],
      });
      const seed = (
        problem: string,
        language: string,
        result: SubmissionResult | null,
        date = hoursFromNow(-2),
      ) =>
        seedSubmission(api, {
          problem,
          language,
          user: users.alice._id,
          contest: contest._id,
          result,
          status: result ? 'D' : 'QU',
          date,
        });
      const { cpp, python } = catalog.languages;
      await seed(problems.alpha._id, cpp, 'AC');
      await seed(problems.alpha._id, cpp, 'WA');
      await seed(problems.alpha._id, python, 'RTE');
      await seed(problems.alpha._id, python, null);
      await seed(problems.beta._id, cpp, 'AC');
      await seed(problems.beta._id, cpp, 'AC', hoursFromNow(-4)); // before the start
      const body = await stats(contest.key);
      expect(
        body.problems.map(({ code, label, results, total, acRate }) => [
          code,
          label,
          results,
          total,
          acRate,
        ]),
      ).toEqual([
        ['alpha', '1', { AC: 1, WA: 1, CE: 0, TLE: 0, ERR: 1, RJ: 0 }, 4, 25],
        ['beta', '2', { AC: 1, WA: 0, CE: 0, TLE: 0, ERR: 0, RJ: 0 }, 1, 100],
      ]);
      expect(
        body.languages.map(({ name, languageKey, count, acRate }) => [
          name,
          languageKey,
          count,
          acRate,
        ]),
      ).toEqual([
        ['C++17', 'CPP17', 3, 200 / 3],
        ['Python 3', 'PY3', 2, 0],
      ]);
    });

    it('refuses stats while the full submission list is hidden, and while frozen to non-editors', async () => {
      const running = await createContest(api, {
        authors: [users.editor._id],
      });
      await api.http().get(contestUrl(running.key, '/stats')).expect(403);
      await authed(
        api.http().get(contestUrl(running.key, '/stats')),
        sessions.editor,
      ).expect(200);
      const frozen = await createContest(api, {
        startTime: hoursFromNow(-3),
        endTime: hoursFromNow(-1),
        formatName: 'icpc',
        formatConfig: {},
        frozenLastMinutes: 60,
        authors: [users.editor._id],
        showSubmissionList: true,
        problems: [contestProblem(problems.alpha._id, 0)],
      });
      await api.http().get(contestUrl(frozen.key, '/stats')).expect(403);
      await authed(
        api.http().get(contestUrl(frozen.key, '/stats')),
        sessions.alice,
      ).expect(403);
      await seedSubmission(api, {
        problem: problems.alpha._id,
        language: catalog.languages.cpp,
        user: users.alice._id,
        contest: frozen._id,
        date: hoursFromNow(-1.5),
      });
      const editorStats = await stats(frozen.key, 'editor');
      expect(editorStats.problems).toMatchObject([
        { code: 'alpha', total: 1, results: { AC: 1 } },
      ]);
      expect(editorStats.languages).toMatchObject([{ count: 1, acRate: 100 }]);
    });
  });
}

// from contest-balloons.e2e-spec.ts
{
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

  describe('contest balloons', () => {
    beforeAll(() => api.reset());
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
      const catalog = await seedCatalog(api);
      const roles: Array<[string, Partial<User>]> = [
        ['editor', { permissions: ['judge.edit_own_contest'] }],
        ['volunteer', {}],
        ['plain', {}],
        ['ann', { rating: 1500 }],
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
    beforeEach(() => clearRateLimits(api));

    it('lists the first solves and the rest in delivery order, with labels, and pages them', async () => {
      const { contest } = await seed();
      const page = await read(contest);
      expect(names(page)).toEqual(['ann:bal_a*', 'bob:bal_a', 'bob:bal_b*']);
      expect(page.data[0].team).toMatchObject({
        username: 'ann',
        rating: 1500,
      });
      expect(page.data[1].team).toMatchObject({
        username: 'bob',
        rating: null,
      });
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
      expect(names(await read(contest, 'volunteer', '?state=pending'))).toEqual(
        ['bob:bal_a', 'bob:bal_b*'],
      );
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
            [problems[0]._id]: {
              time: null,
              points: 0,
              tries: 1,
              pending: true,
            },
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
      await joinParticipation(api, contest._id, users.plain._id, {
        virtual: -1,
      });
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
  });
}

// from contest-feed-keys.e2e-spec.ts
{
  const basic = (user: string, password: string) =>
    `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  const IP = '203.0.113.9';

  describe('feed keys and feed authorisation', () => {
    beforeAll(() => api.reset());
    let auth: FeedAuthService;
    const sessions: Record<string, TestSession> = {};
    const users: Record<string, { _id: string }> = {};
    const url = (contest: Contest, suffix = '') =>
      contestUrl(contest.key, `/feed-key${suffix}`);
    const newContest = () =>
      createContest(api, { authors: [users.editor._id] });
    /** Started two hours ago, ends in one, frozen for the last 90 minutes: frozen now. */
    const frozenContest = () =>
      createContest(api, {
        authors: [users.editor._id],
        formatName: 'icpc',
        startTime: hoursFromNow(-2),
        endTime: hoursFromNow(1),
        frozenLastMinutes: 90,
      });
    const mint = async (contest: Contest, body: object = {}) =>
      dataOf<MintedFeedKeyResponse>(
        await authed(
          api.http().post(url(contest)).send(body),
          sessions.editor,
        ).expect(201),
      );
    const attempt = (
      contest: Contest,
      header: string | undefined,
      now = new Date(),
    ) => auth.authorize({ authorization: header, ip: IP }, contest.key, now);

    beforeAll(async () => {
      auth = api.app.get(FeedAuthService);
      const roles: Array<[string, Partial<User>]> = [
        ['editor', { permissions: ['judge.edit_own_contest'] }],
        ['admin', { isSuperuser: true, isStaff: true }],
        ['plain', {}],
      ];
      for (const [name, extra] of roles) {
        users[name] = await createUserWith(api, name, extra);
        sessions[name] = await loginAs(api, users[name]._id);
      }
    });
    beforeEach(() => clearRateLimits(api));

    it('mints a key once, stores only its sha256 and reports a status without the secret', async () => {
      const contest = await newContest();
      const minted = await mint(contest);
      expect(minted).toMatchObject({
        username: 'feed',
        mode: 'frozen-until-release',
      });
      expect(minted.key).toMatch(/^qhf_/);
      const stored = (await api.feedKeys
        .findOne({ contest: contest._id })
        .lean())!;
      expect(stored.keyHash).toBe(sha256(minted.key));
      expect(JSON.stringify(stored)).not.toContain(minted.key);
      const status = dataOf<FeedKeyStatusResponse>(
        await authed(api.http().get(url(contest)), sessions.editor).expect(200),
      );
      expect(status).toMatchObject({
        isActive: true,
        mode: 'frozen-until-release',
        releasedAt: null,
      });
      expect(JSON.stringify(status)).not.toContain(minted.key);
      expect(new Date(minted.expiresAt).getTime() - Date.now()).toBeGreaterThan(
        13 * 86_400_000,
      );
    });

    it('accepts the key through Basic auth, and a newer key replaces the older one', async () => {
      const contest = await newContest();
      const first = await mint(contest);
      const accepted = await attempt(contest, basic('feed', first.key));
      expect(accepted.contest.key).toBe(contest.key);
      expect(accepted.feedKey.mode).toBe('frozen-until-release');
      const second = await mint(contest);
      await expect(
        attempt(contest, basic('feed', first.key)),
      ).rejects.toMatchObject({ status: 401 });
      await expect(
        attempt(contest, basic('feed', second.key)),
      ).resolves.toBeDefined();
    });

    it('opens one contest only: the key of one contest is refused on another', async () => {
      const [first, second] = [await newContest(), await newContest()];
      const { key } = await mint(first);
      await mint(second);
      await expect(attempt(second, basic('feed', key))).rejects.toMatchObject({
        status: 401,
      });
      await expect(attempt(first, basic('feed', key))).resolves.toBeDefined();
    });

    it.each([
      ['no header', undefined],
      ['a Bearer header', 'Bearer abc'],
      ['another user name', 'USER'],
      ['a wrong key', 'WRONG'],
    ])(
      'refuses %s with the one 401 and a Basic challenge',
      async (_name, header) => {
        const contest = await newContest();
        const { key } = await mint(contest);
        const value =
          header === 'USER'
            ? basic('bob', key)
            : header === 'WRONG'
              ? basic('feed', `${key}x`)
              : header;
        await expect(attempt(contest, value)).rejects.toMatchObject({
          status: 401,
          code: 'unauthorized',
          headers: { 'WWW-Authenticate': 'Basic realm="feed"' },
        });
      },
    );

    it('answers an unknown contest exactly like a wrong key', async () => {
      const wrong = await attempt(
        { key: 'no_such_contest' } as Contest,
        basic('feed', 'qhf_x'),
      ).catch((error: Error) => error);
      const contest = await newContest();
      await mint(contest);
      const real = await attempt(contest, basic('feed', 'qhf_x')).catch(
        (error: Error) => error,
      );
      expect(wrong).toMatchObject({
        status: 401,
        code: 'unauthorized',
        message: (real as Error).message,
      });
    });

    it('refuses an expired key, a revoked key, a deactivated owner and an owner who lost the editor right', async () => {
      const contest = await newContest();
      const { key } = await mint(contest);
      const header = basic('feed', key);
      await expect(
        attempt(contest, header, new Date(Date.now() + 15 * 86_400_000)),
      ).rejects.toMatchObject({ status: 401 });
      await api.contests.updateOne({ _id: contest._id }, { authors: [] });
      await expect(attempt(contest, header)).rejects.toMatchObject({
        status: 401,
      });
      await api.contests.updateOne(
        { _id: contest._id },
        { authors: [users.editor._id] },
      );
      await expect(attempt(contest, header)).resolves.toBeDefined();
      await api.users.updateOne({ _id: users.editor._id }, { isActive: false });
      await expect(attempt(contest, header)).rejects.toMatchObject({
        status: 401,
      });
      await api.users.updateOne({ _id: users.editor._id }, { isActive: true });
      await authed(api.http().delete(url(contest)), sessions.editor).expect(
        204,
      );
      await expect(attempt(contest, header)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('locks an IP after five wrong attempts, even for the right key, and lets successes pass freely', async () => {
      const contest = await newContest();
      const { key } = await mint(contest);
      for (let count = 0; count < 10; count += 1)
        await attempt(contest, basic('feed', key));
      for (let count = 0; count < 5; count += 1)
        await expect(
          attempt(contest, basic('feed', 'wrong')),
        ).rejects.toMatchObject({ status: 401 });
      await expect(
        attempt(contest, basic('feed', 'wrong')),
      ).rejects.toMatchObject({ status: 429 });
      await expect(attempt(contest, basic('feed', key))).rejects.toMatchObject({
        status: 429,
      });
    });

    it('releases the active key during a freeze: 409 without a key, 409 when no freeze is on, 204 and a release time otherwise', async () => {
      const frozen = await frozenContest();
      await authed(api.http().post(url(frozen, '/release')), sessions.editor)
        .expect(409)
        .expect(errorCode('no_active_feed_key'));
      const { key } = await mint(frozen);
      await authed(
        api.http().post(url(frozen, '/release')),
        sessions.editor,
      ).expect(204);
      const status = dataOf<FeedKeyStatusResponse>(
        await authed(api.http().get(url(frozen)), sessions.editor).expect(200),
      );
      expect(status.releasedAt).not.toBeNull();
      expect(
        (await attempt(frozen, basic('feed', key))).feedKey.releasedAt,
      ).not.toBeNull();
      const calm = await newContest();
      await mint(calm);
      await authed(api.http().post(url(calm, '/release')), sessions.editor)
        .expect(409)
        .expect(errorCode('not_frozen'));
      expect(
        (await api.feedKeys.findOne({ contest: calm._id }).lean())!.releasedAt,
      ).toBeNull();
    });

    it('once an IP is locked by fake contest keys, answers every contest the same 429, real, hidden or made up', async () => {
      const hidden = await createContest(api, {
        authors: [users.editor._id],
        isVisible: false,
      });
      const { key } = await mint(hidden);
      for (let count = 0; count < 5; count += 1)
        await expect(
          attempt({ key: `fake_${count}` } as Contest, basic('feed', 'qhf_x')),
        ).rejects.toMatchObject({ status: 401 });
      const statusOf = (answer: Promise<unknown>) =>
        answer.then(
          () => 200,
          (error: { status: number }) => error.status,
        );
      expect([
        await statusOf(
          attempt({ key: 'fake_5' } as Contest, basic('feed', 'qhf_x')),
        ),
        await statusOf(attempt(hidden, basic('feed', 'qhf_x'))),
        await statusOf(attempt(hidden, basic('feed', key))),
      ]).toEqual([429, 429, 429]);
    });

    it('lets only editors mint, revoke, release and read the status', async () => {
      const contest = await newContest();
      await authed(
        api.http().post(url(contest)).send({}),
        sessions.plain,
      ).expect(403);
      await authed(api.http().get(url(contest)), sessions.plain).expect(403);
      await authed(api.http().delete(url(contest)), sessions.plain).expect(403);
      await authed(
        api.http().post(url(contest, '/release')),
        sessions.plain,
      ).expect(403);
      await api.http().post(url(contest)).send({}).expect(401);
    });

    it('refuses minting, revoking and releasing to an API token and to an impersonated session', async () => {
      const contest = await newContest();
      await mint(contest);
      const { token, hash } = generateApiToken(
        users.editor._id,
        TEST_ENV.TOKEN_SECRET,
      );
      await api.users.updateOne(
        { _id: users.editor._id },
        { apiTokenHash: hash },
      );
      for (const [method, suffix] of [
        ['post', ''],
        ['delete', ''],
        ['post', '/release'],
      ] as const)
        await api
          .http()
          [method](url(contest, suffix))
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(403);
      const { id, session } = await api.sessions.create({
        userId: users.editor._id,
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: users.admin._id,
      });
      const impersonated = { cookie: sessionCookie(id), csrf: session.csrf };
      for (const [method, suffix] of [
        ['post', ''],
        ['delete', ''],
        ['post', '/release'],
      ] as const)
        await authed(
          api.http()[method](url(contest, suffix)).send({}),
          impersonated,
        ).expect(403);
      expect(
        await api.feedKeys.countDocuments({
          contest: contest._id,
          revokedAt: null,
        }),
      ).toBe(1);
    });
  });
}
