import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import { newId } from '@libs/database';
import type { Submission, SubmissionStatus } from '@libs/database';
import {
  gradedJobOf,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import type { SubmissionEventType } from '@libs/judging';
import {
  VISITOR_DETAIL_LIMIT,
  visitorDetailKey,
} from '../src/modules/submissions/core/rate-limits';
import { SubmissionsRepository } from '../src/modules/submissions/core/submissions.repository';
import { SubmissionsService } from '../src/modules/submissions/core/submissions.service';
import { STREAM_LIMITS } from '../src/modules/events/stream-limits';
import type { StreamLimits } from '../src/modules/events/stream-limits';
import { softDelete } from './deleted-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { openStream, streamsOf } from './sse-client';
import type { SseClient } from './sse-client';
import { seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const EVENTS = '/api/internal/events/submissions';
const LIMITS: StreamLimits = {
  perUser: 2,
  perIp: 5,
  perAllowlistedIp: 512,
  total: 50,
  feedTotal: 4,
  contestTotal: 4,
  contestFeedTotal: 4,
  userTotal: 50,
  maxBufferedBytes: 256 * 1024,
  ticketBacklog: 1000,
  feedBacklog: 1000,
  heartbeatMs: 100,
  recheckMs: 150,
};

describe('submission event streams', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let streams: ReturnType<typeof streamsOf>;
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
    streams = streamsOf(api);
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
      ['stream_dead', {}],
      ['stream_warm', {}],
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

  it('gates like the result page: 404 unknown or invisible, open to visitors and to viewers without source access', async () => {
    const visible = await seed('stream_a');
    const hidden = await seed('stream_hidden');
    for (const id of [hidden._id, newId(), 'not-an-id']) {
      const missing = await open('owner', `${EVENTS}/${id}`);
      expect(missing.status).toBe(404);
    }
    const visitorOnHidden = await open(null, `${EVENTS}/${hidden._id}`);
    expect(visitorOnHidden.status).toBe(404);
    // `other` has not solved the problem, so the source stays closed to them; the result is not.
    for (const who of [null, 'other']) {
      const watcher = await open(who, `${EVENTS}/${visible._id}`);
      expect(watcher.status).toBe(200);
      await watcher.next('state');
    }
  });

  it("closes a visitor's stream once the problem becomes invisible", async () => {
    const flipped = await seed('stream_flip');
    const visitor = await open(null, `${EVENTS}/${flipped._id}`);
    await visitor.next('state');
    await api.problems.updateOne(
      { _id: problems.stream_flip },
      { isPublic: false },
    );
    await visitor.closed;
    await api.problems.updateOne(
      { _id: problems.stream_flip },
      { isPublic: true },
    );
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

  it('public feed: drops events beyond the backlog and tells the feed to resync once it drains', async () => {
    const feed = await open(null, EVENTS);
    await waitUntil(() => streams.openCounts().feed === 1);
    const rows = api.app.get(SubmissionsRepository);
    const findContestId = rows.findContestId.bind(rows);
    const slow = jest
      .spyOn(rows, 'findContestId')
      .mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return findContestId(...args);
      });
    LIMITS.feedBacklog = 3;
    try {
      for (let count = 0; count < 6; count += 1)
        await publish(await seed('stream_a'), 'done', 'D');
      await feed.next('resync', 5000);
    } finally {
      slow.mockRestore();
      LIMITS.feedBacklog = 1000;
    }
    const done = feed.messages.filter((message) => message.event === 'done');
    expect(done.length).toBeLessThan(6);
  });

  it('public feed: deleting a problem it already trusts drops its submissions at once, restoring brings them back', async () => {
    const feed = await open(null, EVENTS);
    await waitUntil(() => streams.openCounts().feed === 1);
    /** Publishes the submission, then a marker on a live problem; events arrive in order, so the next frame tells. */
    const delivered = async (submission: Submission) => {
      const marker = await seed('stream_a');
      await publish(submission, 'done', 'D');
      await publish(marker, 'done', 'D');
      const { submissionId } = (await feed.next('done')).data as {
        submissionId: string;
      };
      if (submissionId === marker._id) return false;
      await feed.next('done');
      return submissionId === submission._id;
    };
    const lifecycle = (method: 'delete' | 'post', path: string) =>
      authed(
        api.http()[method](`/api/internal/problems/stream_warm${path}`),
        sessions.root,
      ).send({ confirmCode: 'stream_warm' });
    expect(await delivered(await seed('stream_warm'))).toBe(true);
    await lifecycle('delete', '').expect(204);
    expect(await delivered(await seed('stream_warm'))).toBe(false);
    await lifecycle('post', '/restore').expect(204);
    expect(await delivered(await seed('stream_warm'))).toBe(true);
  });

  it('a deleted problem: owner and staff watch the status but never the cases, others get 404', async () => {
    await softDelete(api, problems.stream_dead);
    const submission = await seed('stream_dead');
    const path = `${EVENTS}/${submission._id}`;
    const owner = await open('owner', path);
    const root = await open('root', path);
    const stranger = await open('other', path);
    expect(stranger.status).toBe(404);
    expect((await owner.next('state')).data).toMatchObject({
      currentTestcase: null,
    });
    await root.next('state');
    await publish(submission, 'test-case', 'G', 2);
    await publish(submission, 'done', 'D');
    await owner.next('done');
    await root.next('done');
    for (const client of [owner, root])
      expect(client.messages.map(({ event }) => event)).not.toContain(
        'test-case',
      );
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

  it('treats a session short of 2FA as a visitor: no user cap, and the visitor detail limit applies to every visitor stream', async () => {
    const submission = await seed('stream_a');
    const path = `${EVENTS}/${submission._id}`;
    const pending = await loginAs(api, ids.owner, { twoFaPassed: false });
    sessions['pending'] = pending;
    // perUser is 2: a pending session would be refused on its third stream if it used the user's cap.
    for (let count = 0; count < 3; count += 1)
      expect((await open('pending', path)).status).toBe(200);
    const redis = api.app.get<Redis>(REDIS);
    const [key] = await redis.keys(`rate:${visitorDetailKey('*')}`);
    await redis.set(key, VISITOR_DETAIL_LIMIT, 'KEEPTTL');
    try {
      expect((await open(null, path)).status).toBe(429);
      expect((await open('pending', path)).status).toBe(429);
      expect((await open('other', path)).status).toBe(200);
    } finally {
      await redis.del(key);
    }
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
      contests: 0,
      tickets: 0,
      userStreams: 0,
      subscriberListeners: 1,
    });
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
      contests: 0,
      tickets: 0,
      userStreams: 0,
      subscriberListeners: 0,
    });
    await expect(streams.onModuleDestroy()).resolves.toBeUndefined();
  });
});
