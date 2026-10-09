import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { NOTIFICATION_FANOUT_QUEUE } from '@libs/community';
import type { NotificationFanoutJob } from '@libs/community';
import type { AnnouncementResponse } from '../src/modules/contests/announcements/dto/announcement.response';
import { clearRateLimits, contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest announcements enqueue the notification fan-out', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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
