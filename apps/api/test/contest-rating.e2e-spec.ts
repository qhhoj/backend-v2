import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_RATING_QUEUE } from '@libs/contests';
import type { ContestRatingJob } from '@libs/contests';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest rating request', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
    ratingQueue = api.app.get(getQueueToken(CONTEST_RATING_QUEUE));
    for (const [name, permissions] of Object.entries(roles)) {
      users[name] = await createUserWith(api, name, { permissions });
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterAll(() => api.teardown());
  beforeEach(() => ratingQueue.obliterate({ force: true }));

  it('queues a rating for an editor with judge.contest_rating once the contest ended', async () => {
    const contest = await endedContest([users.rater._id]);
    const response = await rate('rater', contest.key).expect(202);
    expect(dataOf(response)).toEqual({ queued: true });
    expect(
      (await ratingQueue.getJobs(['waiting'])).map((job) => job.data),
    ).toEqual([{ contestId: contest._id }]);
  });

  it('queues another run for every request', async () => {
    const contest = await endedContest([users.rater._id]);
    await rate('rater', contest.key).expect(202);
    await rate('rater', contest.key).expect(202);
    expect(await ratingQueue.getWaitingCount()).toBe(2);
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
