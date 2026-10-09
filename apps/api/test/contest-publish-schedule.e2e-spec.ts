import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_PUBLISH_QUEUE, publishJobId } from '@libs/contests';
import type { ContestPublishJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { contestUrl, createContest, hoursFromNow } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('scheduling of the automatic publish', () => {
  let api: ApiTest;
  let queue: Queue<ContestPublishJob>;
  let editor: TestSession;
  let editorId: string;
  const jobIds = async () =>
    (await queue.getJobs(['delayed', 'waiting'])).map((job) => job.id);
  const patch = (key: string, body: object) =>
    authed(api.http().patch(contestUrl(key)), editor).send(body);

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(CONTEST_PUBLISH_QUEUE));
    editorId = (
      await createUserWith(api, 'schedule_editor', {
        permissions: [
          'judge.add_contest',
          'judge.edit_own_contest',
          'judge.clone_contest',
        ],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  afterAll(() => api.teardown());
  beforeEach(() => queue.obliterate({ force: true }));

  it('schedules the job when the switch comes on, moves it with the end time and drops it when the switch goes off', async () => {
    const contest = await createContest(api, {
      authors: [editorId],
      endTime: hoursFromNow(3),
    });
    expect(await jobIds()).toEqual([]);
    await patch(contest.key, { publishAfterEnd: true }).expect(200);
    expect(await jobIds()).toEqual([
      publishJobId(contest._id, contest.endTime),
    ]);
    const later = hoursFromNow(4);
    await patch(contest.key, { endTime: later.toISOString() }).expect(200);
    expect(await jobIds()).toEqual([publishJobId(contest._id, later)]);
    await patch(contest.key, { publishAfterEnd: false }).expect(200);
    expect(await jobIds()).toEqual([]);
  });

  it('schedules a contest created with the switch on', async () => {
    const endTime = hoursFromNow(3);
    await authed(api.http().post('/api/internal/contests'), editor)
      .send({
        key: 'schedule_create',
        name: 'Scheduled',
        startTime: hoursFromNow(1).toISOString(),
        endTime: endTime.toISOString(),
        publishAfterEnd: true,
      })
      .expect(201);
    const id = uuidStr(
      (await api.contests.findOne({ key: 'schedule_create' }).lean())!._id,
    );
    expect(await jobIds()).toEqual([publishJobId(id, endTime)]);
  });

  it('starts a clone with the switch off, no editor and no outcome', async () => {
    const source = await createContest(api, {
      authors: [editorId],
      endTime: hoursFromNow(3),
      publishAfterEnd: true,
      publishAfterEndBy: editorId,
      autoPublishOutcome: {
        at: new Date(),
        status: 'failed',
        reason: 'no_permission',
        published: 0,
        skipped: 1,
      },
    });
    await authed(api.http().post(contestUrl(source.key, '/clone')), editor)
      .send({ key: 'schedule_copy' })
      .expect(201);
    const copy = (await api.contests.findOne({ key: 'schedule_copy' }).lean())!;
    expect(copy).toMatchObject({
      publishAfterEnd: false,
      publishAfterEndBy: null,
      autoPublishOutcome: null,
    });
    expect(await jobIds()).toEqual([]);
  });
});
