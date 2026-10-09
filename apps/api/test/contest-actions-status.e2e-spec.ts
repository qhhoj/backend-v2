import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CONTEST_EXPORT_JOB,
  CONTEST_EXPORT_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_PUBLISH_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
  enqueueContestRating,
  enqueueContestRescore,
  oneJobPerContest,
  requestFinalJudge,
  requestReplayBuild,
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
      await authed(api.http().get(contestUrl(key, '/actions')), session).expect(
        200,
      ),
    );
  const idle: ContestActionsResponse = {
    rescore: 'idle',
    judgeFinal: 'idle',
    rate: 'idle',
    publish: 'idle',
    replay: 'idle',
    export: 'idle',
    autoPublish: null,
  };

  beforeAll(async () => {
    api = await setupApiTest();
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
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await rescores.obliterate({ force: true });
    await finalJudges.obliterate({ force: true });
    await ratings.obliterate({ force: true });
    await publishes.obliterate({ force: true });
    await replays.obliterate({ force: true });
    await exports.obliterate({ force: true });
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

  it('reports an export queued while its job waits, and idle for another contest', async () => {
    const [mine, other] = [
      await createContest(api, { authors: [editorId] }),
      await createContest(api, { authors: [editorId] }),
    ];
    await exports.add(
      CONTEST_EXPORT_JOB,
      { contestId: mine._id },
      { ...oneJobPerContest('export', mine._id), delay: 60_000 },
    );
    expect(await statusOf(mine.key)).toEqual({ ...idle, export: 'queued' });
    expect(await statusOf(other.key)).toEqual(idle);
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
    expect(await statusOf(contest.key)).toEqual({ ...idle, publish: 'queued' });
  });

  it('reports a replay build queued while its request waits, and idle for another contest', async () => {
    const [mine, other] = [
      await createContest(api, { authors: [editorId] }),
      await createContest(api, { authors: [editorId] }),
    ];
    await requestReplayBuild(replays, mine._id);
    expect(await statusOf(mine.key)).toEqual({ ...idle, replay: 'queued' });
    expect(await statusOf(other.key)).toEqual(idle);
  });

  it('echoes the recorded outcome of the automatic publish', async () => {
    const at = new Date();
    const contest = await createContest(api, {
      authors: [editorId],
      autoPublishOutcome: {
        at,
        status: 'failed',
        reason: 'no_permission',
        published: 0,
        skipped: 3,
      },
    });
    expect((await statusOf(contest.key)).autoPublish).toEqual({
      at: at.toISOString(),
      status: 'failed',
      reason: 'no_permission',
      published: 0,
      skipped: 3,
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
