import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import type { FeedEvent } from '@libs/contests';
import type { Contest, User } from '@libs/database';
import {
  DEFAULT_STREAM_LIMITS,
  STREAM_LIMITS,
} from '../src/modules/events/stream-limits';
import { EventStreamHubService } from '../src/modules/events/event-stream-hub.service';
import {
  DEFAULT_FEED_LIMITS,
  FEED_LIMITS,
} from '../src/modules/contests/feed/feed.service';
import {
  FEED_STREAM_OPTIONS,
  FeedStreamService,
} from '../src/modules/contests/feed/feed-stream.service';
import type { MintedFeedKeyResponse } from '../src/modules/contests/feed/dto/feed-key.dto';
import {
  clearRateLimits,
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const basic = (key: string) =>
  `Basic ${Buffer.from(`feed:${key}`).toString('base64')}`;
const TICK_MS = 100;
const KEEP_ALIVE_MS = 150;

interface Stream {
  status: number;
  events: FeedEvent[];
  /** Everything received, blank keep-alive lines included. */
  raw: () => string;
  closed: Promise<void>;
  close: () => void;
}

describe('contest event feed stream', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Array<{ _id: string }> = [];
  const open: Stream[] = [];
  const feedLimits = { ...DEFAULT_FEED_LIMITS };
  const streamLimits = { ...DEFAULT_STREAM_LIMITS };
  const port = () => (api.app.getHttpServer().address() as AddressInfo).port;
  const mint = async (contest: Contest, body: object = {}) =>
    dataOf<MintedFeedKeyResponse>(
      await authed(
        api.http().post(contestUrl(contest.key, '/feed-key')).send(body),
        sessions.editor,
      ).expect(201),
    ).key;

  const connect = (contest: Contest, key: string): Promise<Stream> =>
    new Promise((resolve, reject) => {
      const request = http.get(
        {
          host: '127.0.0.1',
          port: port(),
          path: `/api/internal/events/contests/${contest.key}/feed`,
          headers: { Authorization: basic(key) },
        },
        (response: IncomingMessage) => {
          const events: FeedEvent[] = [];
          let rest = '';
          let raw = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => {
            raw += chunk;
            rest += chunk;
            const lines = rest.split('\n');
            rest = lines.pop()!;
            for (const line of lines)
              if (line.startsWith('{'))
                events.push(JSON.parse(line) as FeedEvent);
          });
          const closed = new Promise<void>((done) =>
            response.once('close', () => done()),
          );
          const stream = {
            status: response.statusCode!,
            events,
            raw: () => raw,
            closed,
            close: () => request.destroy(),
          };
          open.push(stream);
          resolve(stream);
        },
      );
      request.on('error', reject);
    });
  const until = async (condition: () => boolean, ms = 4000) => {
    const deadline = Date.now() + ms;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('condition not met');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const ofType = (stream: Stream, type: string) =>
    stream.events.filter((event) => event.type === type);

  const submit = async (
    contest: Contest,
    participation: string,
    date: Date,
    result: 'AC' | 'WA',
  ) => {
    const submission = await seedSubmission(api, {
      user: users.ann._id,
      problem: problems[0]._id,
      language: catalog.languages.cpp,
      date,
      contest: contest._id,
      status: 'D',
      result,
      judgedDate: date,
    });
    await api.contestSubmissions.create({
      _id: submission._id,
      participation,
      contest: contest._id,
      problem: problems[0]._id,
      points: result === 'AC' ? 100 : 0,
    });
    return submission;
  };
  const seed = async (extra: Partial<Contest> = {}) => {
    const contest = await createContest(api, {
      formatName: 'icpc',
      authors: [users.editor._id],
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
      problems: [contestProblem(problems[0]._id, 0)],
      ...extra,
    });
    return {
      contest,
      ann: await joinParticipation(api, contest._id, users.ann._id),
    };
  };

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [
        {
          provide: FEED_STREAM_OPTIONS,
          useValue: { intervalMs: TICK_MS, keepAliveMs: KEEP_ALIVE_MS },
        },
        { provide: FEED_LIMITS, useValue: feedLimits },
        { provide: STREAM_LIMITS, useValue: streamLimits },
      ],
    });
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['ann', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.push(await createProblem(api, catalog, { code: 'stream_a' }));
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));
  afterEach(async () => {
    Object.assign(feedLimits, DEFAULT_FEED_LIMITS);
    Object.assign(streamLimits, DEFAULT_STREAM_LIMITS);
    for (const stream of open.splice(0)) stream.close();
    await until(
      () => api.app.get(EventStreamHubService).openCounts().total === 0,
    );
  });

  it('sends the snapshot, then only the new events with tokens that keep counting', async () => {
    const { contest, ann } = await seed({ endTime: hoursFromNow(1) });
    const first = await submit(contest, ann._id, hoursFromNow(-2), 'WA');
    const stream = await connect(contest, await mint(contest));
    expect(stream.status).toBe(200);
    await until(() => ofType(stream, 'state').length >= 1);
    expect(ofType(stream, 'submissions').map((event) => event.id)).toEqual([
      first._id,
    ]);
    const sent = stream.events.length;
    // A tick reads the rows submitted or judged since the last one, so a live submission is dated now.
    const second = await submit(contest, ann._id, new Date(), 'AC');
    await until(() => ofType(stream, 'submissions').length === 2);
    await until(() => ofType(stream, 'judgements').length === 2);
    const tail = stream.events.slice(sent);
    expect(tail.map((event) => event.type).sort()).toEqual([
      'judgements',
      'submissions',
    ]);
    expect(tail.every((event) => event.id === second._id)).toBe(true);
    const tokens = stream.events.map((event) => Number(event.token));
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(tokens).toEqual([...tokens].sort((left, right) => left - right));
  });

  it('counts in the hub caps while open and gives the slot back on close', async () => {
    const { contest } = await seed();
    const hub = api.app.get(EventStreamHubService);
    const stream = await connect(contest, await mint(contest));
    await until(() => stream.events.length > 0);
    expect(hub.openCounts().total).toBe(1);
    stream.close();
    await until(() => hub.openCounts().total === 0);
  });

  it('allows two streams per key and refuses a third', async () => {
    const { contest } = await seed();
    const key = await mint(contest);
    const [one, two] = [
      await connect(contest, key),
      await connect(contest, key),
    ];
    expect([one.status, two.status]).toEqual([200, 200]);
    expect((await connect(contest, key)).status).toBe(429);
    one.close();
    await one.closed;
    await until(
      () => api.app.get(EventStreamHubService).openCounts().total === 1,
    );
    expect((await connect(contest, key)).status).toBe(200);
  });

  it('closes the stream when the key is revoked or its owner loses the editor right', async () => {
    const { contest } = await seed();
    const revoked = await connect(contest, await mint(contest));
    await until(() => revoked.events.length > 0);
    await authed(
      api.http().delete(contestUrl(contest.key, '/feed-key')),
      sessions.editor,
    ).expect(204);
    await revoked.closed;
    const demoted = await connect(contest, await mint(contest));
    await until(() => demoted.events.length > 0);
    await api.contests.updateOne({ _id: contest._id }, { authors: [] });
    await demoted.closed;
  });

  it('ends every open stream when the application shuts down', async () => {
    const { contest } = await seed();
    const stream = await connect(contest, await mint(contest));
    await until(() => stream.events.length > 0);
    api.app.get(FeedStreamService).onModuleDestroy();
    await stream.closed;
  });

  it('writes a blank keep-alive line on a quiet stream, which readers skip', async () => {
    const { contest } = await seed();
    const stream = await connect(contest, await mint(contest));
    await until(() => stream.events.length > 0);
    const received = stream.events.length;
    await until(() => stream.raw().includes('\n\n'));
    expect(stream.events).toHaveLength(received);
  });

  it('refuses to stream a contest past the stream cap, before sending anything, and gives the slots back', async () => {
    const { contest, ann } = await seed();
    await submit(contest, ann._id, hoursFromNow(-2), 'AC');
    const key = await mint(contest);
    feedLimits.maxStreamSubmissions = 0;
    expect((await connect(contest, key)).status).toBe(409);
    expect(api.app.get(EventStreamHubService).openCounts().total).toBe(0);
    feedLimits.maxStreamSubmissions = DEFAULT_FEED_LIMITS.maxStreamSubmissions;
    expect((await connect(contest, key)).status).toBe(200);
  });

  it('holds feed streams to the feed cap and to the per-IP cap, and frees the slot on close', async () => {
    const { contest } = await seed();
    const key = await mint(contest);
    streamLimits.feedTotal = 1;
    const only = await connect(contest, key);
    expect((await connect(contest, key)).status).toBe(429);
    streamLimits.feedTotal = DEFAULT_STREAM_LIMITS.feedTotal;
    streamLimits.perIp = 1;
    expect((await connect(contest, key)).status).toBe(429);
    only.close();
    await only.closed;
    await until(
      () => api.app.get(EventStreamHubService).openCounts().total === 0,
    );
    expect((await connect(contest, key)).status).toBe(200);
  });

  it('refuses a wrong key before streaming anything', async () => {
    const { contest } = await seed();
    const stream = await connect(contest, 'qhf_wrong');
    expect(stream.status).toBe(401);
  });

  it('never emits frozen events while gated, and emits them once the key is released', async () => {
    const { contest, ann } = await seed({
      endTime: hoursFromNow(0.5),
      frozenLastMinutes: 60,
    });
    const before = await submit(contest, ann._id, hoursFromNow(-2), 'AC');
    const key = await mint(contest);
    const stream = await connect(contest, key);
    await until(() => ofType(stream, 'state').length >= 1);
    const frozen = await submit(contest, ann._id, new Date(), 'WA');
    await new Promise((resolve) => setTimeout(resolve, TICK_MS * 6));
    expect(ofType(stream, 'submissions').map((event) => event.id)).toEqual([
      before._id,
    ]);
    expect(JSON.stringify(stream.events)).not.toContain(frozen._id);
    expect(
      ofType(stream, 'state').every((event) => event.data.thawed === null),
    ).toBe(true);
    await authed(
      api.http().post(contestUrl(contest.key, '/feed-key/release')),
      sessions.editor,
    ).expect(204);
    await until(() =>
      ofType(stream, 'submissions').some((event) => event.id === frozen._id),
    );
    await until(() => ofType(stream, 'state').length === 2);
  });
});
