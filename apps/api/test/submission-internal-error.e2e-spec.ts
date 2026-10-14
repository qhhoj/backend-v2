import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { generateApiToken } from '@libs/auth';
import { Revision } from '@libs/database';
import type { Submission } from '@libs/database';
import {
  gradedJobOf,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import {
  contestProblem,
  contestUrl,
  createContest,
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
import { openStream } from './sse-client';
import type { SseClient } from './sse-client';
import { seedSubmission } from './submission-fixtures';
import { setupApiTest, TEST_ENV } from './setup';
import type { ApiTest } from './setup';

const SUBMISSIONS = '/api/internal/submissions';
/** A testlib checker's `_fail` line: it quotes the jury's answer. */
const JURY_TEXT =
  "checker failed with exit code 3: FAIL Participant found 12 days, which is strictly better than jury's 8 days";

/** The judge's internal-error message reaches the problem's editors only: never the submitter or another contestant, on any route. */
describe('internal error messages', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let problemId: string;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  const opened: SseClient[] = [];
  const get = (who: string, path: string) =>
    authed(api.http().get(path), sessions[who]);
  const seed = async (fields: Partial<Submission> = {}) =>
    (
      await seedSubmission(api, {
        user: ids.owner,
        problem: problemId,
        language: catalog.languages.cpp,
        status: 'IE',
        result: 'IE',
        error: JURY_TEXT,
        ...fields,
      })
    )._id;
  const errorSeenBy = async (who: string, id: string) =>
    (
      (await get(who, `${SUBMISSIONS}/${id}`).expect(200)).body as {
        data: { status: string; error: string | null };
      }
    ).data;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, object]> = [
      ['owner', {}],
      ['other', {}],
      ['viewall', { permissions: ['judge.view_all_submission'] }],
      ['editor', { permissions: ['judge.edit_own_problem'] }],
      [
        'scorer',
        { permissions: ['judge.edit_own_problem', 'judge.change_submission'] },
      ],
      ['root', { isSuperuser: true }],
    ];
    for (const [name, extra] of roles) {
      ids[name] = (await createUserWith(api, name, extra))._id;
      sessions[name] = await loginAs(api, ids[name]);
    }
    problemId = (
      await createProblem(api, catalog, {
        code: 'iefail',
        authors: [ids.editor, ids.scorer],
        submissionSourceVisibility: 'A',
        testcaseResultVisibility: 'A',
        allowViewFeedback: true,
      })
    )._id;
  });
  beforeEach(() => api.submissions.deleteMany({}));
  afterEach(() => {
    for (const client of opened.splice(0)) client.close();
  });
  afterAll(() => api.teardown());

  it('detail: hides the message from the submitter and other non-editors, shows it to editors', async () => {
    const id = await seed();
    for (const who of ['owner', 'other', 'viewall'])
      expect(await errorSeenBy(who, id)).toMatchObject({
        status: 'IE',
        error: null,
      });
    for (const who of ['editor', 'root'])
      expect((await errorSeenBy(who, id)).error).toBe(JURY_TEXT);
  });

  it('detail: an API token reads it like a session, so a non-editor token gets no message', async () => {
    const id = await seed();
    const { token, hash } = generateApiToken(ids.owner, TEST_ENV.TOKEN_SECRET);
    await api.users.updateOne({ _id: ids.owner }, { apiTokenHash: hash });
    const response = await api
      .http()
      .get(`${SUBMISSIONS}/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(response.body)).not.toContain('jury');
  });

  it('detail: the compile log and compiler warnings stay visible to the submitter, case feedback too', async () => {
    const compileError = await seed({
      status: 'CE',
      result: 'CE',
      error: 'main.cpp:1:1: error',
    });
    expect((await errorSeenBy('owner', compileError)).error).toBe(
      'main.cpp:1:1: error',
    );
    const graded = await seed({
      status: 'D',
      result: 'WA',
      error: 'main.cpp:2:1: warning',
      cases: [
        {
          position: 1,
          status: 'WA',
          time: 0.1,
          memory: 100,
          points: 0,
          total: 1,
          batch: null,
          feedback: 'wrong answer 1st numbers differ',
          extendedFeedback: 'expected 8, found 12',
          output: '12',
        },
      ],
    });
    const response = await get('owner', `${SUBMISSIONS}/${graded}`).expect(200);
    expect(response.body).toMatchObject({
      data: {
        error: 'main.cpp:2:1: warning',
        cases: [
          {
            feedback: 'wrong answer 1st numbers differ',
            extendedFeedback: 'expected 8, found 12',
          },
        ],
      },
    });
  });

  it('score override: the message leaves the row for its revision, so a graded-looking row shows nobody jury data', async () => {
    const id = await seed();
    await authed(api.http().put(`${SUBMISSIONS}/${id}/score`), sessions.scorer)
      .send({ result: 'AC', points: 1000, comment: 'checker bug' })
      .expect(204);
    for (const who of ['owner', 'other', 'editor'])
      expect(await errorSeenBy(who, id)).toMatchObject({
        status: 'D',
        error: null,
      });
    const revision = await api.app
      .get<Model<Revision>>(getModelToken(Revision.name))
      .findOne({ entity: 'submission', entityId: id })
      .lean();
    expect(revision?.changes).toMatchObject({
      error: { before: JURY_TEXT, after: null },
    });
  });

  it('lists and the contest views carry no message, for the submitter in their running contest either', async () => {
    const contest = await createContest(api, {
      formatName: 'icpc',
      showSubmissionList: true,
      problems: [contestProblem(problemId, 0)],
    });
    const participation = await joinParticipation(api, contest._id, ids.owner);
    const id = await seed({ contest: contest._id });
    await api.contestSubmissions.create({
      _id: id,
      participation: participation._id,
      contest: contest._id,
      problem: problemId,
    });
    await makeCurrent(api, ids.owner, participation._id);
    try {
      for (const path of [
        `${SUBMISSIONS}?user=owner`,
        contestUrl(contest.key, '/submissions'),
        `${SUBMISSIONS}/${id}`,
      ]) {
        const response = await get('owner', path).expect(200);
        expect(JSON.stringify(response.body)).toContain(id);
        expect(JSON.stringify(response.body)).not.toContain('jury');
      }
    } finally {
      await makeCurrent(api, ids.owner, null);
    }
  });

  it('live stream: no frame carries the message', async () => {
    const submission = await api.submissions.findById(await seed());
    const stream = await openStream(
      api,
      `/api/internal/events/submissions/${submission!._id}`,
      { Cookie: sessions.owner.cookie },
    );
    opened.push(stream);
    const frames = [await stream.next('state')];
    await api.app
      .get(SubmissionEventsService)
      .publish(submissionEvent(gradedJobOf(submission!), 'done', 'IE', 0));
    frames.push(await stream.next('done'));
    expect(frames).toMatchObject([
      { data: { status: 'IE' } },
      { data: { status: 'IE' } },
    ]);
    expect(JSON.stringify(frames)).not.toContain('jury');
  });
});
