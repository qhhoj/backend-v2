import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_RESCORE_QUEUE,
  enqueueContestRating,
  enqueueContestRescore,
  requestFinalJudge,
} from '@libs/contests';
import type {
  ContestFinalJudgeJob,
  ContestRatingJob,
  ContestRescoreJob,
} from '@libs/contests';
import type { ContestActionsResponse } from '../src/modules/contests/editing/dto/contest-actions.response';
import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest action status', () => {
  let api: ApiTest;
  let rescores: Queue<ContestRescoreJob>;
  let finalJudges: Queue<ContestFinalJudgeJob>;
  let ratings: Queue<ContestRatingJob>;
  let editor: TestSession;
  let plain: TestSession;
  let editorId: string;

  const statusOf = async (
    key: string,
    session: TestSession = editor,
  ): Promise<ContestActionsResponse> =>
    dataOf<ContestActionsResponse>(
      await authed(api.http().get(contestUrl(key, '/actions')), session).expect(
        200,
      ),
    );
  const idle: ContestActionsResponse = {
    rescore: 'idle',
    judgeFinal: 'idle',
    rate: 'idle',
  };

  beforeAll(async () => {
    api = await setupApiTest();
    rescores = api.app.get(getQueueToken(CONTEST_RESCORE_QUEUE));
    finalJudges = api.app.get(getQueueToken(CONTEST_FINAL_JUDGE_QUEUE));
    ratings = api.app.get(getQueueToken(CONTEST_RATING_QUEUE));
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
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await rescores.obliterate({ force: true });
    await finalJudges.obliterate({ force: true });
    await ratings.obliterate({ force: true });
  });

  it('reports every action idle without a job', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    expect(await statusOf(contest.key)).toEqual(idle);
  });

  it('reports a rescore queued while its request waits', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    await enqueueContestRescore(rescores, contest._id);
    expect(await statusOf(contest.key)).toEqual({ ...idle, rescore: 'queued' });
  });

  it('reports a rating queued while its request waits', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    await enqueueContestRating(ratings, contest._id);
    expect(await statusOf(contest.key)).toEqual({ ...idle, rate: 'queued' });
  });

  it('reports a manual final judging queued', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    await requestFinalJudge(finalJudges, contest._id);
    expect(await statusOf(contest.key)).toEqual({
      ...idle,
      judgeFinal: 'queued',
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
