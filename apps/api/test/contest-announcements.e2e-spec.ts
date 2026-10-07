import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import type { User } from '@libs/database';
import { ANNOUNCEMENT_PUSH_LIMIT } from '../src/modules/contests/core/rate-limits';
import type { AnnouncementResponse } from '../src/modules/contests/announcements/dto/announcement.response';
import {
  DEFAULT_STREAM_LIMITS,
  STREAM_LIMITS,
} from '../src/modules/submissions/rate-limits';
import { SubmissionStreamsService } from '../src/modules/submissions/submission-streams.service';
import { clearRateLimits, contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { openStream } from './sse-client';
import type { SseClient } from './sse-client';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest announcements', () => {
  let api: ApiTest;
  let streams: SubmissionStreamsService;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const opened: SseClient[] = [];
  const open = async (key: string, who: string | null = null) => {
    const client = await openStream(
      api,
      `/api/internal/events/contests/${key}`,
      who ? { Cookie: sessions[who].cookie } : {},
    );
    opened.push(client);
    return client;
  };
  const post = (
    role: string,
    key: string,
    body: Record<string, unknown>,
    suffix = '',
  ) =>
    authed(
      api.http().post(contestUrl(key, `/announcements${suffix}`)),
      sessions[role],
    ).send(body);
  const createAnnouncement = async (role: string, key: string, title = 'T') =>
    dataOf<AnnouncementResponse>(
      await post(role, key, { title, description: 'body' }).expect(201),
    );
  const announcementFrames = (client: SseClient) =>
    client.messages.filter((message) => message.event === 'announcement');
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 200));

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [
        {
          provide: STREAM_LIMITS,
          useValue: {
            ...DEFAULT_STREAM_LIMITS,
            contestTotal: 3,
            heartbeatMs: 100,
            recheckMs: 150,
          },
        },
      ],
    });
    streams = api.app.get(SubmissionStreamsService);
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['plain', {}],
      ['alice', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterEach(async () => {
    for (const client of opened.splice(0)) client.close();
    await waitUntil(() => streams.openCounts().total === 0);
  });
  afterAll(() => api.teardown());

  it('stores rendered announcements for editors and lists them newest first to viewers', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    await post('plain', contest.key, { title: 'Hi', description: 'x' }).expect(
      403,
    );
    const first = dataOf<AnnouncementResponse>(
      await post('editor', contest.key, {
        title: 'Clarification',
        description: 'Read **A** again',
      }).expect(201),
    );
    expect(first.descriptionHtml).toContain('<strong>A</strong>');
    await post('editor', contest.key, {
      title: 'Second',
      description: '',
    }).expect(201);
    const listed = (
      await api
        .http()
        .get(contestUrl(contest.key, '/announcements'))
        .expect(200)
    ).body as { data: AnnouncementResponse[]; meta: { total: number } };
    expect([listed.data.map((item) => item.title), listed.meta.total]).toEqual([
      ['Second', 'Clarification'],
      2,
    ]);
    const hostile = dataOf<AnnouncementResponse>(
      await post('editor', contest.key, {
        title: 'Hostile',
        description: '<script>x()</script><b onclick="y()">bold</b>',
      }).expect(201),
    );
    expect(hostile.descriptionHtml).not.toMatch(/<script|onclick/i);
    const served = (
      await api
        .http()
        .get(contestUrl(contest.key, '/announcements'))
        .expect(200)
    ).body as { data: AnnouncementResponse[] };
    expect(served.data[0].descriptionHtml).not.toMatch(/<script|onclick/i);
    await post('editor', contest.key, {
      title: 'x'.repeat(101),
      description: '',
    }).expect(400);
    await post('editor', contest.key, { title: '', description: '' }).expect(
      400,
    );
  });

  it('paginates the list and hides announcements of an invisible contest', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    for (const title of ['a', 'b', 'c'])
      await createAnnouncement('editor', contest.key, title);
    const page = (
      await api
        .http()
        .get(contestUrl(contest.key, '/announcements?page=2&pageSize=2'))
        .expect(200)
    ).body as { data: AnnouncementResponse[]; meta: { total: number } };
    expect([page.data.map((item) => item.title), page.meta.total]).toEqual([
      ['a'],
      3,
    ]);
    await api
      .http()
      .get(contestUrl(contest.key, '/announcements?pageSize=51'))
      .expect(400);
    const hidden = await createContest(api, { isVisible: false });
    await api.http().get(contestUrl(hidden.key, '/announcements')).expect(404);
  });

  it('pushes announcement ids to viewers of the contest only and closes a stream once access is lost', async () => {
    const contest = await createContest(api, {
      authors: [users.editor._id],
      pushAnnouncements: true,
    });
    const other = await createContest(api, { pushAnnouncements: true });
    const viewer = await open(contest.key, 'alice');
    const anonymous = await open(contest.key);
    const elsewhere = await open(other.key);
    const created = await createAnnouncement(
      'editor',
      contest.key,
      'Secret title',
    );
    for (const client of [viewer, anonymous])
      expect((await client.next('announcement')).data).toEqual({
        contestId: contest._id,
        announcementId: created.id,
      });
    await quiet();
    expect(announcementFrames(elsewhere)).toEqual([]);
    await api.contests.updateOne({ _id: contest._id }, { isPrivate: true });
    await Promise.all([viewer.closed, anonymous.closed]);
  });

  it('closes a contest stream once its session ends, even on a public contest', async () => {
    const contest = await createContest(api);
    const session = await loginAs(api, users.alice._id);
    const stream = await openStream(
      api,
      `/api/internal/events/contests/${contest.key}`,
      { Cookie: session.cookie },
    );
    opened.push(stream);
    expect(stream.status).toBe(200);
    await api.sessions.destroy(session.cookie.split('=')[1]);
    await stream.closed;
  });

  it('keeps delivering announcements after the Redis subscription drops, telling clients to resync', async () => {
    const contest = await createContest(api, {
      authors: [users.editor._id],
      pushAnnouncements: true,
    });
    const client = await open(contest.key);
    await api.app.get<Redis>(REDIS).call('CLIENT', 'KILL', 'TYPE', 'pubsub');
    await client.next('resync', 5000);
    await waitUntil(() => streams.isSubscribed());
    const created = await createAnnouncement('editor', contest.key);
    expect((await client.next('announcement')).data).toEqual({
      contestId: contest._id,
      announcementId: created.id,
    });
  });

  it('refuses a stream of an invisible contest and caps contest streams per process', async () => {
    const hidden = await createContest(api, { isVisible: false });
    expect((await open(hidden.key)).status).toBe(404);
    const contest = await createContest(api);
    const clients = await Promise.all([1, 2, 3].map(() => open(contest.key)));
    expect(clients.map((client) => client.status)).toEqual([200, 200, 200]);
    expect((await open(contest.key)).status).toBe(429);
  });

  it('stores without pushing when pushAnnouncements is off', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    const client = await open(contest.key);
    const created = await createAnnouncement('editor', contest.key);
    await post('editor', contest.key, {}, `/${created.id}/resend`).expect(204);
    await quiet();
    expect(announcementFrames(client)).toEqual([]);
    const listed = (
      await api
        .http()
        .get(contestUrl(contest.key, '/announcements'))
        .expect(200)
    ).body as { data: AnnouncementResponse[] };
    expect(listed.data.map((item) => item.id)).toEqual([created.id]);
  });

  it('resends a stored announcement on request when pushing is on, for editors of the contest', async () => {
    const contest = await createContest(api, {
      authors: [users.editor._id],
      pushAnnouncements: true,
    });
    const other = await createContest(api, { authors: [users.editor._id] });
    const client = await open(contest.key);
    const created = await createAnnouncement('editor', contest.key);
    await client.next('announcement');
    await post('plain', contest.key, {}, `/${created.id}/resend`).expect(403);
    await post('editor', other.key, {}, `/${created.id}/resend`).expect(404);
    await post('editor', contest.key, {}, `/${created.id}/resend`).expect(204);
    expect((await client.next('announcement')).data).toEqual({
      contestId: contest._id,
      announcementId: created.id,
    });
  });

  it('limits pushes per contest', async () => {
    await clearRateLimits(api);
    const contest = await createContest(api, {
      authors: [users.editor._id],
      pushAnnouncements: true,
    });
    for (let index = 0; index < ANNOUNCEMENT_PUSH_LIMIT; index += 1)
      await post('editor', contest.key, {
        title: `#${index}`,
        description: '',
      }).expect(201);
    await post('editor', contest.key, { title: 'one more', description: '' })
      .expect(429)
      .expect(errorCode('rate_limited'));
    const listed = (
      await api
        .http()
        .get(contestUrl(contest.key, '/announcements'))
        .expect(200)
    ).body as { meta: { total: number } };
    expect(listed.meta.total).toBe(ANNOUNCEMENT_PUSH_LIMIT);
  });

  it('deletes an announcement of this contest only', async () => {
    const contest = await createContest(api, { authors: [users.editor._id] });
    const other = await createContest(api, { authors: [users.editor._id] });
    const created = await createAnnouncement('editor', contest.key);
    const remove = (role: string, key: string) =>
      authed(
        api.http().delete(contestUrl(key, `/announcements/${created.id}`)),
        sessions[role],
      );
    await remove('plain', contest.key).expect(403);
    await remove('editor', other.key).expect(404);
    await remove('editor', contest.key).expect(204);
    const listed = (
      await api
        .http()
        .get(contestUrl(contest.key, '/announcements'))
        .expect(200)
    ).body as { meta: { total: number } };
    expect(listed.meta.total).toBe(0);
    await remove('editor', contest.key).expect(404);
  });
});
