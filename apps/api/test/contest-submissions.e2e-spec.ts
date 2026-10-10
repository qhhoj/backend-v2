import type { User } from '@libs/database';
import { waitUntil } from '@libs/common/testing';
import {
  gradedJobOf,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionListItemResponse } from '../src/modules/submissions/core/dto/submission-list.response';
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
import { openStream, streamsOf } from './sse-client';
import type { SseClient } from './sse-client';
import { dataOf, seedSubmission } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const EVENTS = '/api/internal/events/submissions';

describe('contest submissions and the freeze', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const opened: SseClient[] = [];
  const get = (path: string, who?: string) =>
    who ? authed(api.http().get(path), sessions[who]) : api.http().get(path);
  const idsOf = (response: { body: unknown }) =>
    dataOf<SubmissionListItemResponse[]>(response).map((item) => item.id);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['bob', {}],
      ['author', { permissions: ['judge.edit_own_contest'] }],
      ['staff', { permissions: ['judge.view_all_submission'] }],
      ['problemAuthor', { permissions: ['judge.edit_own_problem'] }],
      ['allContests', { permissions: ['judge.edit_all_contest'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterEach(async () => {
    for (const client of opened.splice(0)) client.close();
    await Promise.all(opened.map((client) => client.closed));
  });
  afterAll(() => api.teardown());

  /** A frozen icpc contest on a public problem whose sources everyone may read. */
  const frozenScene = async (
    code: string,
    contestExtra = {},
    problemExtra = {},
  ) => {
    const problem = await createProblem(api, catalog, {
      code,
      submissionSourceVisibility: 'A',
      ...problemExtra,
    });
    const contest = await createContest(api, {
      formatName: 'icpc',
      frozenLastMinutes: 180,
      showSubmissionList: true,
      authors: [users.author._id],
      problems: [contestProblem(problem._id, 0)],
      ...contestExtra,
    });
    const inContest = async (who: string) => {
      const participation = await joinParticipation(
        api,
        contest._id,
        users[who]._id,
      );
      const submission = await seedSubmission(api, {
        user: users[who]._id,
        problem: problem._id,
        language: catalog.languages.cpp,
        contest: contest._id,
      });
      await api.contestSubmissions.create({
        _id: submission._id,
        participation: participation._id,
        contest: contest._id,
        problem: problem._id,
      });
      await makeCurrent(api, users[who]._id, participation._id);
      return submission._id;
    };
    const aliceId = await inContest('alice');
    const bobId = await inContest('bob');
    const bobOutside = (
      await seedSubmission(api, {
        user: users.bob._id,
        problem: problem._id,
        language: catalog.languages.cpp,
      })
    )._id;
    return { contest, aliceId, bobId, bobOutside };
  };

  it("hides other participants' contest submissions from every submission route while frozen", async () => {
    const { contest, aliceId, bobId, bobOutside } =
      await frozenScene('frozen_p');
    const contestList = contestUrl(contest.key, '/submissions');
    expect(idsOf(await get(contestList, 'alice').expect(200))).toEqual([
      aliceId,
    ]);
    await get(`${contestList}?user=bob`, 'alice').expect(403);
    await get(contestList).expect(403);
    const global = idsOf(
      await get('/api/internal/submissions?problem=frozen_p', 'alice').expect(
        200,
      ),
    );
    expect(global.sort()).toEqual([aliceId, bobOutside].sort());
    expect(
      idsOf(
        await get('/api/internal/submissions?problem=frozen_p').expect(200),
      ),
    ).toEqual([bobOutside]);
    await get(`/api/internal/submissions/${bobId}`, 'alice')
      .expect(403)
      .expect(errorCode('contest_running'));
    await get(`/api/internal/submissions/${bobId}/source`, 'alice')
      .expect(403)
      .expect(errorCode('contest_running'));
    await get(`/api/internal/submissions/${aliceId}`, 'alice').expect(200);
    for (const who of ['author', 'staff']) {
      expect(
        idsOf(
          await get('/api/internal/submissions?problem=frozen_p', who).expect(
            200,
          ),
        ).sort(),
      ).toEqual([aliceId, bobId, bobOutside].sort());
      await get(`/api/internal/submissions/${bobId}`, who).expect(200);
    }
    expect(idsOf(await get(contestList, 'author').expect(200)).sort()).toEqual(
      [aliceId, bobId].sort(),
    );
  });

  it('answers contest_running, not solve_first, for an unsolved if-solved source while the list is closed', async () => {
    const { bobId } = await frozenScene(
      'if_solved_p',
      {},
      { submissionSourceVisibility: 'S' },
    );
    await get(`/api/internal/submissions/${bobId}/source`, 'alice')
      .expect(403)
      .expect(errorCode('contest_running'));
  });

  it("opens a frozen contest submission of a source-hidden problem to the contest's editors, and to nobody else", async () => {
    const { bobId } = await frozenScene(
      'editor_rule_p',
      {},
      { submissionSourceVisibility: 'O' },
    );
    await get(`/api/internal/submissions/${bobId}`, 'author').expect(200);
    await get(`/api/internal/submissions/${bobId}`, 'alice')
      .expect(403)
      .expect(errorCode('hidden'));
  });

  it('opens a frozen contest submission by id to the problem author, who still does not see it in lists', async () => {
    const { aliceId } = await frozenScene(
      'problem_editor_p',
      {},
      { authors: [users.problemAuthor._id] },
    );
    await get(`/api/internal/submissions/${aliceId}`, 'problemAuthor').expect(
      200,
    );
    expect(
      idsOf(
        await get(
          '/api/internal/submissions?problem=problem_editor_p',
          'problemAuthor',
        ).expect(200),
      ),
    ).not.toContain(aliceId);
  });

  it('opens a frozen contest submission by id to an edit_all_contest holder who is no author', async () => {
    // Source visibility O: only the contest-editor path can open it for this viewer.
    const { bobId } = await frozenScene(
      'frozen_all',
      {},
      { submissionSourceVisibility: 'O' },
    );
    await get(`/api/internal/submissions/${bobId}`, 'allContests').expect(200);
  });

  it('keeps an ended icpc contest frozen until an editor unfreezes it', async () => {
    const { contest, bobId } = await frozenScene('ended_frozen_p');
    await api.contests.updateOne(
      { _id: contest._id },
      { startTime: hoursFromNow(-5), endTime: hoursFromNow(-1) },
    );
    await get(`/api/internal/submissions/${bobId}`, 'alice').expect(403);
    expect(
      idsOf(
        await get(
          '/api/internal/submissions?problem=ended_frozen_p',
          'alice',
        ).expect(200),
      ),
    ).not.toContain(bobId);
    await get(contestUrl(contest.key, '/submissions?user=bob'), 'alice').expect(
      403,
    );
  });

  it('opens every route once the contest ended unfrozen', async () => {
    const { contest, bobId } = await frozenScene('thawed_p');
    await api.contests.updateOne(
      { _id: contest._id },
      {
        frozenLastMinutes: 0,
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      },
    );
    expect(
      idsOf(
        await get(
          contestUrl(contest.key, '/submissions?user=bob'),
          'alice',
        ).expect(200),
      ),
    ).toEqual([bobId]);
    expect(
      idsOf(
        await get('/api/internal/submissions?problem=thawed_p&user=bob').expect(
          200,
        ),
      ),
    ).toContain(bobId);
    await get(`/api/internal/submissions/${bobId}`, 'alice').expect(200);
  });

  it('keeps a running unfrozen contest list to the viewer unless the contest shows it', async () => {
    const { contest, aliceId, bobId } = await frozenScene('open_p');
    await api.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 0, showSubmissionList: false },
    );
    expect(
      idsOf(
        await get(contestUrl(contest.key, '/submissions'), 'alice').expect(200),
      ),
    ).toEqual([aliceId]);
    await api.contests.updateOne(
      { _id: contest._id },
      { showSubmissionList: true },
    );
    expect(
      idsOf(
        await get(contestUrl(contest.key, '/submissions'), 'alice').expect(200),
      ).sort(),
    ).toEqual([aliceId, bobId].sort());
  });

  const endedUnfrozen = {
    frozenLastMinutes: 0,
    startTime: hoursFromNow(-5),
    endTime: hoursFromNow(-1),
  };

  it("lists an ended contest on private problems and ignores the viewer's other current contest", async () => {
    const { contest, aliceId, bobId } = await frozenScene(
      'private_list_p',
      endedUnfrozen,
      { isPublic: false },
    );
    const list = contestUrl(contest.key, '/submissions');
    for (const who of ['alice', undefined])
      expect(idsOf(await get(list, who).expect(200)).sort()).toEqual(
        [aliceId, bobId].sort(),
      );
    const upcoming = await createContest(api, {
      startTime: hoursFromNow(5),
      endTime: hoursFromNow(8),
    });
    await makeCurrent(
      api,
      users.alice._id,
      (await joinParticipation(api, upcoming._id, users.alice._id))._id,
    );
    expect(idsOf(await get(list, 'alice').expect(200)).sort()).toEqual(
      [aliceId, bobId].sort(),
    );
  });

  it('keeps the list of a private contest to its contestants', async () => {
    const { contest, aliceId, bobId } = await frozenScene('private_contest_p', {
      ...endedUnfrozen,
      isPrivate: true,
      privateContestants: [users.alice._id],
    });
    const list = contestUrl(contest.key, '/submissions');
    await get(list).expect(404);
    await get(list, 'bob').expect(404);
    expect(idsOf(await get(list, 'alice').expect(200)).sort()).toEqual(
      [aliceId, bobId].sort(),
    );
  });

  it.each([
    [
      'a running unfrozen contest that hides its list',
      'running_hidden_p',
      {
        formatName: 'default',
        frozenLastMinutes: 0,
        showSubmissionList: false,
      },
    ],
    [
      'an ended contest with a hidden scoreboard',
      'ended_h_p',
      { ...endedUnfrozen, formatName: 'default', scoreboardVisibility: 'H' },
    ],
  ])(
    "hides another participant's submissions of %s from the global lists",
    async (_label, code, extra) => {
      const { aliceId, bobId, bobOutside } = await frozenScene(code, extra);
      expect(
        idsOf(
          await get(
            `/api/internal/submissions?problem=${code}`,
            'alice',
          ).expect(200),
        ).sort(),
      ).toEqual([aliceId, bobOutside].sort());
      await get(`/api/internal/submissions/${bobId}`, 'alice').expect(403);
    },
  );

  it('shows the full list to a viewer whose windowed participation ended under a P scoreboard', async () => {
    const { contest, aliceId, bobId, bobOutside } = await frozenScene(
      'completed_p',
      {
        formatName: 'default',
        frozenLastMinutes: 0,
        showSubmissionList: true,
        scoreboardVisibility: 'P',
        timeLimit: 3600,
      },
    );
    await api.participations.updateMany(
      { contest: contest._id, user: users.alice._id },
      { realStart: hoursFromNow(-1.5) },
    );
    const global = '/api/internal/submissions?problem=completed_p';
    expect(idsOf(await get(global, 'alice').expect(200)).sort()).toEqual(
      [aliceId, bobId, bobOutside].sort(),
    );
    expect(idsOf(await get(global, 'bob').expect(200)).sort()).toEqual(
      [bobId, bobOutside].sort(),
    );
  });

  it('streams a frozen contest submission only to its owner and entitled viewers', async () => {
    const { aliceId } = await frozenScene('stream_frozen_p');
    const open = async (who: string) => {
      const client = await openStream(api, `${EVENTS}/${aliceId}`, {
        Cookie: sessions[who].cookie,
      });
      opened.push(client);
      return client;
    };
    expect((await open('bob')).status).toBe(403);
    for (const who of ['alice', 'author', 'staff'])
      expect((await open(who)).status).toBe(200);
  });

  const publishDone = async (id: string) => {
    const submission = await api.submissions.findById(id).lean().exec();
    await api.app
      .get(SubmissionEventsService)
      .publish(submissionEvent(gradedJobOf(submission!), 'done', 'D'));
  };
  const openFeeds = async () => {
    const streams = streamsOf(api);
    const feeds = [
      await openStream(api, EVENTS),
      await openStream(api, EVENTS, { Cookie: sessions.alice.cookie }),
    ];
    opened.push(...feeds);
    await waitUntil(() => streams.openCounts().feed === feeds.length);
    return feeds;
  };
  /** The feed delivers in order, so the practice event arriving first proves the contest one was dropped. */
  const nextDoneIds = async (feeds: SseClient[]) =>
    Promise.all(
      feeds.map(
        async (feed) =>
          ((await feed.next('done')).data as { submissionId: string })
            .submissionId,
      ),
    );

  it.each([
    ['a frozen contest', 'feed_frozen_p', {}],
    [
      'a running contest that hides its list',
      'feed_running_p',
      {
        formatName: 'default',
        frozenLastMinutes: 0,
        showSubmissionList: false,
      },
    ],
    [
      'a running contest with a hidden scoreboard',
      'feed_board_h_p',
      {
        formatName: 'default',
        frozenLastMinutes: 0,
        scoreboardVisibility: 'H',
      },
    ],
  ])(
    'keeps submissions of %s out of the public feed, anonymous or signed in',
    async (_label, code, extra) => {
      const { bobId, bobOutside } = await frozenScene(code, extra);
      const feeds = await openFeeds();
      await publishDone(bobId);
      await publishDone(bobOutside);
      expect(await nextDoneIds(feeds)).toEqual([bobOutside, bobOutside]);
      for (const feed of feeds) expect(feed.messages).toEqual([]);
    },
  );

  it('streams a contest submission on the public feed once the list is open, as ids and status', async () => {
    const { contest, bobId } = await frozenScene('feed_thawed_p');
    const feeds = await openFeeds();
    await api.contests.updateOne({ _id: contest._id }, endedUnfrozen);
    await publishDone(bobId);
    expect(await nextDoneIds(feeds)).toEqual([bobId, bobId]);
    await publishDone(bobId);
    const frame = (await feeds[0].next('done')).data as Record<string, unknown>;
    expect(Object.keys(frame).sort()).toEqual(
      ['problemId', 'status', 'submissionId', 'type', 'userId'].sort(),
    );
  });

  it("still streams a frozen contest submission's live updates to its owner", async () => {
    const { aliceId } = await frozenScene('feed_owner_p');
    const own = await openStream(api, `${EVENTS}/${aliceId}`, {
      Cookie: sessions.alice.cookie,
    });
    opened.push(own);
    await own.next('state');
    await publishDone(aliceId);
    expect((await own.next('done')).data).toMatchObject({
      submissionId: aliceId,
      status: 'D',
    });
  });
});
