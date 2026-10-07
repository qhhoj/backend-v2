import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_FINAL_JUDGE_QUEUE, finalJudgeJobId } from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestDetailResponse } from '../src/modules/contests/dto/contest-detail.response';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('FSO final judging in the api', () => {
  let api: ApiTest;
  let queue: Queue<ContestFinalJudgeJob>;
  let editor: TestSession;
  let plain: TestSession;
  let editorId: string;
  const jobIds = async () =>
    (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(CONTEST_FINAL_JUDGE_QUEUE));
    editorId = (
      await createUserWith(api, 'fso_editor', {
        permissions: ['judge.add_contest', 'judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
    plain = await loginAs(api, (await createUserWith(api, 'fso_plain'))._id);
  });
  afterAll(() => api.teardown());
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
    expect((await queue.getJobs(['waiting'])).map((job) => job.data)).toEqual([
      { contestId: ended._id, manual: true },
    ]);
  });
});
