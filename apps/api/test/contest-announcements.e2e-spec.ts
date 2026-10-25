import type Redis from 'ioredis';

import { REDIS } from '@libs/common';

import { waitUntil } from '@libs/common/testing';

import type { User } from '@libs/database';

import type { AnnouncementResponse } from '../src/modules/contests/announcements/dto/announcement.response';

import {
  DEFAULT_STREAM_LIMITS,
  STREAM_LIMITS,
} from '../src/modules/events/stream-limits';

import { contestUrl, createContest } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';

import type { TestSession } from './problem-fixtures';

import { openStream, streamsOf } from './sse-client';

import type { SseClient } from './sse-client';

import { dataOf } from './submission-fixtures';

import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest announcements', () => {
  let api: ApiTest;
  let streams: ReturnType<typeof streamsOf>;
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
            perUser: 2,
            heartbeatMs: 100,
            recheckMs: 150,
          },
        },
      ],
    });
    streams = streamsOf(api);
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

  it('treats a session short of its 2FA as anonymous when opening a stream', async () => {
    const hidden = await createContest(api, {
      isVisible: false,
      authors: [users.editor._id],
    });
    sessions.pendingEditor = await loginAs(api, users.editor._id, {
      twoFaPassed: false,
    });
    expect((await open(hidden.key, 'editor')).status).toBe(200);
    expect((await open(hidden.key, 'pendingEditor')).status).toBe(404);
  });

  it('does not count the streams of a session short of its 2FA against its user', async () => {
    const contest = await createContest(api);
    sessions.pendingAlice = await loginAs(api, users.alice._id, {
      twoFaPassed: false,
    });
    // perUser is 2: a third stream would be refused if the pending session used the user's cap.
    for (let count = 0; count < 3; count += 1)
      expect((await open(contest.key, 'pendingAlice')).status).toBe(200);
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
