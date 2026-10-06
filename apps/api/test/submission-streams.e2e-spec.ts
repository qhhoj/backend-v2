import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { newId } from '@libs/database';
import type { Submission, SubmissionStatus } from '@libs/database';
import {
  gradedJobOf,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionEventType } from '@libs/judging';
import { SubmissionsService } from '../src/modules/submissions/submissions.service';
import { STREAM_LIMITS } from '../src/modules/submissions/rate-limits';
import type { StreamLimits } from '../src/modules/submissions/rate-limits';
import { SubmissionStreamsService } from '../src/modules/submissions/submission-streams.service';
import {
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { openStream, waitUntil } from './sse-client';
import type { SseClient } from './sse-client';
import { seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const EVENTS = '/api/internal/events/submissions';
const LIMITS: StreamLimits = {
  perUser: 2,
  perIp: 5,
  total: 50,
  feedTotal: 4,
  maxBufferedBytes: 256 * 1024,
  heartbeatMs: 100,
  recheckMs: 150,
};

describe('submission event streams', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let streams: SubmissionStreamsService;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};
  const problems: Record<string, string> = {};
  const opened: SseClient[] = [];
  const open = async (who: string | null, path: string) => {
    const client = await openStream(
      api,
      path,
      who ? { Cookie: sessions[who].cookie } : {},
    );
    opened.push(client);
    return client;
  };
  const seed = async (problem: string, fields: Partial<Submission> = {}) =>
    seedSubmission(api, {
      user: ids.owner,
      problem: problems[problem],
      language: catalog.languages.cpp,
      status: 'QU',
      result: null,
      ...fields,
    });
  const publish = (
    submission: Submission,
    type: SubmissionEventType,
    status: SubmissionStatus,
    currentTestcase = 0,
  ) =>
    api.app
      .get(SubmissionEventsService)
      .publish(
        submissionEvent(gradedJobOf(submission), type, status, currentTestcase),
      );
  const errorOf = async (client: SseClient) =>
    (JSON.parse(await client.body) as { error: { code: string } }).error.code;

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [{ provide: STREAM_LIMITS, useValue: LIMITS }],
    });
    catalog = await seedCatalog(api);
    streams = api.app.get(SubmissionStreamsService);
    for (const [name, extra] of [
      ['owner', {}],
      ['other', {}],
      ['root', { isSuperuser: true }],
    ] as const) {
      ids[name] = (await createUserWith(api, name, extra))._id;
      sessions[name] = await loginAs(api, ids[name]);
    }
    for (const [code, extra] of [
      ['stream_a', {}],
      ['stream_s', { testcaseResultVisibility: 'S' }],
      ['stream_hidden', { isPublic: false }],
      ['stream_org', { isOrganizationPrivate: true }],
      ['stream_flip', {}],
    ] as const)
      problems[code] = (
        await createProblem(api, catalog, { code, ...extra })
      )._id;
  });
  afterEach(async () => {
    for (const client of opened.splice(0)) client.close();
    await waitUntil(() => streams.openCounts().total === 0);
  });
  afterAll(() => api.teardown());

  it('sends the current state first, then the submission events in order', async () => {
    const submission = await seed('stream_a');
    const client = await open('owner', `${EVENTS}/${submission._id}`);
    expect(client.status).toBe(200);
    expect((await client.next('state')).data).toMatchObject({
      submissionId: submission._id,
      status: 'QU',
    });
    await publish(submission, 'processing', 'P');
    await publish(submission, 'grading-begin', 'G');
    await publish(submission, 'test-case', 'G', 3);
    await publish(submission, 'done', 'D');
    expect((await client.next('processing')).data).toMatchObject({
      status: 'P',
    });
    expect((await client.next('grading-begin')).data).toMatchObject({
      status: 'G',
    });
    expect((await client.next('test-case')).data).toMatchObject({
      currentTestcase: 3,
    });
    expect((await client.next('done')).data).toMatchObject({ status: 'D' });
  });

  it('gates like the detail: 401 anonymous, 404 unknown or invisible, 403 without detail rights', async () => {
    const visible = await seed('stream_a');
    const hidden = await seed('stream_hidden');
    const anonymous = await open(null, `${EVENTS}/${visible._id}`);
    expect(anonymous.status).toBe(401);
    expect(await errorOf(anonymous)).toBe('unauthorized');
    for (const id of [hidden._id, newId(), 'not-an-id']) {
      const missing = await open('owner', `${EVENTS}/${id}`);
      expect(missing.status).toBe(404);
    }
    const stranger = await open('other', `${EVENTS}/${visible._id}`);
    expect(stranger.status).toBe(403);
    expect(await errorOf(stranger)).toBe('forbidden');
  });

  it('sends test-case progress only to viewers who see every case result', async () => {
    const submission = await seed('stream_s');
    const owner = await open('owner', `${EVENTS}/${submission._id}`);
    const root = await open('root', `${EVENTS}/${submission._id}`);
    await owner.next('state');
    await root.next('state');
    await publish(submission, 'test-case', 'G', 2);
    await publish(submission, 'done', 'D');
    await owner.next('done');
    await root.next('test-case');
    await root.next('done');
    expect(owner.messages.some(({ event }) => event === 'test-case')).toBe(
      false,
    );
  });

  it('public feed: only public, non-organisation-private problems, without progress', async () => {
    const feed = await open(null, EVENTS);
    expect(feed.status).toBe(200);
    await waitUntil(() => streams.openCounts().feed === 1);
    const hidden = await seed('stream_hidden');
    const orgPrivate = await seed('stream_org');
    const visible = await seed('stream_a');
    await publish(hidden, 'done', 'D');
    await publish(orgPrivate, 'done', 'D');
    await publish(visible, 'test-case', 'G', 2);
    await publish(visible, 'done', 'D');
    expect((await feed.next('done')).data).toEqual({
      submissionId: visible._id,
      userId: ids.owner,
      problemId: problems.stream_a,
      type: 'done',
      status: 'D',
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(feed.messages).toEqual([]);
  });

  it('caps open streams per user and per IP, and frees a slot on disconnect', async () => {
    const submission = await seed('stream_a');
    const path = `${EVENTS}/${submission._id}`;
    const first = await open('owner', path);
    await open('owner', path);
    const third = await open('owner', path);
    expect(third.status).toBe(429);
    expect(await errorOf(third)).toBe('rate_limited');
    first.close();
    await waitUntil(() => streams.openCounts().total === 1);
    expect((await open('owner', path)).status).toBe(200);
    for (let feeds = 0; feeds < LIMITS.perIp - 2; feeds += 1)
      expect((await open(null, EVENTS)).status).toBe(200);
    const overIp = await open(null, EVENTS);
    expect(overIp.status).toBe(429);
  });

  it('answers 429 before 404 or 403, and a refused stream keeps no slot', async () => {
    const submission = await seed('stream_a');
    const path = `${EVENTS}/${submission._id}`;
    await open('owner', path);
    await open('owner', path);
    expect((await open('owner', `${EVENTS}/${newId()}`)).status).toBe(429);
    const forbidden = await open('other', path);
    expect(forbidden.status).toBe(403);
    await forbidden.closed;
    await waitUntil(() => streams.openCounts().total === 2);
    expect(streams.openCounts().users).toBe(1);
  });

  it('caps the public feed per process separately', async () => {
    for (let feeds = 0; feeds < LIMITS.feedTotal; feeds += 1)
      expect((await open(null, EVENTS)).status).toBe(200);
    expect((await open(null, EVENTS)).status).toBe(429);
    expect(
      (await open('owner', `${EVENTS}/${(await seed('stream_a'))._id}`)).status,
    ).toBe(200);
  });

  it('leaves no stream, counter or listener behind after clients disconnect', async () => {
    const submission = await seed('stream_a');
    await open('owner', `${EVENTS}/${submission._id}`);
    await open('root', `${EVENTS}/${submission._id}`);
    await open(null, EVENTS);
    await waitUntil(() => streams.openCounts().total === 3);
    for (const client of opened.splice(0)) client.close();
    await waitUntil(() => streams.openCounts().total === 0);
    expect(streams.openCounts()).toEqual({
      total: 0,
      users: 0,
      ips: 0,
      submissions: 0,
      feed: 0,
      subscriberListeners: 1,
    });
  });

  it('closes a stream once its session ends or its problem becomes invisible', async () => {
    const session = await loginAs(api, ids.owner);
    const submission = await seed('stream_a');
    const ending = await openStream(api, `${EVENTS}/${submission._id}`, {
      Cookie: session.cookie,
    });
    opened.push(ending);
    await ending.next('state');
    await api.sessions.destroy(session.cookie.split('=')[1]);
    await ending.closed;
    const flipped = await seed('stream_flip');
    const losing = await open('owner', `${EVENTS}/${flipped._id}`);
    await losing.next('state');
    await api.problems.updateOne(
      { _id: problems.stream_flip },
      { isPublic: false },
    );
    await losing.closed;
  });

  it('closes the stream of a user who was deactivated', async () => {
    const leaver = await createUserWith(api, 'leaver');
    const session = await loginAs(api, leaver._id);
    const submission = await seed('stream_a', { user: leaver._id });
    const client = await openStream(api, `${EVENTS}/${submission._id}`, {
      Cookie: session.cookie,
    });
    opened.push(client);
    await client.next('state');
    await api.users.updateOne({ _id: leaver._id }, { isActive: false });
    await client.closed;
  });

  it('frees everything when a slow client is dropped', async () => {
    const submission = await seed('stream_a');
    const normalBytes = LIMITS.maxBufferedBytes;
    LIMITS.maxBufferedBytes = 100;
    try {
      const slow = await open(null, EVENTS);
      await waitUntil(() => streams.openCounts().feed === 1);
      await publish(submission, 'done', 'D');
      await slow.closed;
    } finally {
      LIMITS.maxBufferedBytes = normalBytes;
    }
    await waitUntil(() => streams.openCounts().total === 0);
    expect(streams.openCounts()).toEqual({
      total: 0,
      users: 0,
      ips: 0,
      submissions: 0,
      feed: 0,
      subscriberListeners: 1,
    });
  });

  it('keeps delivering after the Redis subscription drops, telling clients to resync', async () => {
    const submission = await seed('stream_a');
    const client = await open('owner', `${EVENTS}/${submission._id}`);
    await client.next('state');
    await api.app.get<Redis>(REDIS).call('CLIENT', 'KILL', 'TYPE', 'pubsub');
    await client.next('resync', 5000);
    await waitUntil(() => streams.isSubscribed());
    await publish(submission, 'done', 'D');
    expect((await client.next('done')).data).toMatchObject({ status: 'D' });
  });

  it('heartbeats an idle stream', async () => {
    const feed = await open(null, EVENTS);
    await waitUntil(() => feed.pings() >= 2, 2000);
  });

  it('frees the slot of a client that left while the access lookups were pending', async () => {
    const submission = await seed('stream_a');
    const service = api.app.get(SubmissionsService);
    const original = service.streamAccess.bind(service);
    const delayed = jest
      .spyOn(service, 'streamAccess')
      .mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return original(...args);
      });
    try {
      const { port } = api.app.getHttpServer().address() as AddressInfo;
      const aborted = httpRequest({
        host: '127.0.0.1',
        port,
        path: `${EVENTS}/${submission._id}`,
        headers: { Cookie: sessions.owner.cookie },
      });
      aborted.on('error', () => undefined);
      aborted.end();
      await waitUntil(() => streams.openCounts().total === 1);
      aborted.destroy();
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      delayed.mockRestore();
    }
    expect(streams.openCounts()).toMatchObject({
      total: 0,
      users: 0,
      ips: 0,
      submissions: 0,
    });
  });

  it('does not lose an event published while the stream was opening', async () => {
    const submission = await seed('stream_a');
    const service = api.app.get(SubmissionsService);
    const original = service.streamAccess.bind(service);
    const racing = jest
      .spyOn(service, 'streamAccess')
      .mockImplementation(async (...args) => {
        const access = await original(...args);
        await api.submissions.updateOne(
          { _id: submission._id },
          { status: 'D', result: 'AC' },
        );
        await publish(submission, 'done', 'D');
        return access;
      });
    try {
      const client = await open('owner', `${EVENTS}/${submission._id}`);
      expect((await client.next('state')).data).toMatchObject({ status: 'D' });
    } finally {
      racing.mockRestore();
    }
  });

  it('keeps a client up when a burst of events arrives in one tick', async () => {
    const submission = await seed('stream_a');
    const client = await open('owner', `${EVENTS}/${submission._id}`);
    await client.next('state');
    await Promise.all(
      Array.from({ length: 300 }, () => publish(submission, 'processing', 'P')),
    );
    await waitUntil(
      () =>
        client.messages.filter(({ event }) => event === 'processing').length ===
        300,
      5000,
    );
  });

  it('delivers to a stream opened with an uppercase id', async () => {
    const submission = await seed('stream_a');
    const client = await open(
      'owner',
      `${EVENTS}/${submission._id.toUpperCase()}`,
    );
    await client.next('state');
    await publish(submission, 'done', 'D');
    await client.next('done');
  });

  it('drops a paused feed client under a flood, with memory bounded', async () => {
    const submission = await seed('stream_a');
    const { port } = api.app.getHttpServer().address() as AddressInfo;
    const paused = httpRequest({ host: '127.0.0.1', port, path: EVENTS });
    paused.on('error', () => undefined);
    paused.on('response', (response) => {
      response.socket.pause();
      response.pause();
    });
    paused.end();
    await waitUntil(() => streams.openCounts().feed === 1);
    const rssBefore = process.memoryUsage().rss;
    // Small batches: no single tick passes the cap, only the accumulated backlog can.
    for (
      let batch = 0;
      batch < 3000 && streams.openCounts().feed === 1;
      batch += 1
    )
      await Promise.all(
        Array.from({ length: 200 }, () => publish(submission, 'done', 'D')),
      );
    await waitUntil(() => streams.openCounts().feed === 0, 5000);
    global.gc?.();
    expect(process.memoryUsage().rss - rssBefore).toBeLessThan(
      200 * 1024 * 1024,
    );
    paused.destroy();
  }, 60_000);

  it('closes every stream and its Redis listener on shutdown, and shutting down twice is harmless', async () => {
    const submission = await seed('stream_a');
    const subscribed = await open('owner', `${EVENTS}/${submission._id}`);
    const feed = await open(null, EVENTS);
    await waitUntil(() => streams.openCounts().total === 2);
    await streams.onModuleDestroy();
    await Promise.all([subscribed.closed, feed.closed]);
    expect(streams.openCounts()).toEqual({
      total: 0,
      users: 0,
      ips: 0,
      submissions: 0,
      feed: 0,
      subscriberListeners: 0,
    });
    await expect(streams.onModuleDestroy()).resolves.toBeUndefined();
  });
});
