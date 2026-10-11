import { waitUntil } from '@libs/common/testing';
import { NotificationsService } from '@libs/community';
import { uuidStr } from '@libs/database';
import {
  DEFAULT_STREAM_LIMITS,
  STREAM_LIMITS,
} from '../src/modules/events/stream-limits';
import { createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { openStream, streamsOf } from './sse-client';
import type { SseClient } from './sse-client';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const USER_EVENTS = '/api/internal/events/user';

describe('user event stream', () => {
  let api: ApiTest;
  let streams: ReturnType<typeof streamsOf>;
  const people: Record<string, { id: string; session: TestSession }> = {};
  const opened: SseClient[] = [];
  const open = async (who: string | null, path = USER_EVENTS) => {
    const client = await openStream(
      api,
      path,
      who ? { Cookie: people[who].session.cookie } : {},
    );
    opened.push(client);
    return client;
  };
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 250));
  const notify = (who: string, groupKey: string) =>
    api.app.get(NotificationsService).notify([people[who].id], {
      kind: 'ticket-message',
      title: 'Có trả lời mới',
      body: '',
      path: '/tickets/1',
      priority: 'normal',
      groupKey,
    });

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [
        {
          provide: STREAM_LIMITS,
          useValue: {
            ...DEFAULT_STREAM_LIMITS,
            perIp: 6,
            perUser: 4,
            total: 20,
            userTotal: 3,
            heartbeatMs: 100,
            recheckMs: 150,
          },
        },
      ],
    });
    streams = streamsOf(api);
    for (const name of ['u1', 'u2', 'u3', 'u4']) {
      const user = await createUserWith(api, name);
      people[name] = { id: user._id, session: await loginAs(api, user._id) };
    }
  });
  afterEach(async () => {
    for (const client of opened.splice(0)) client.close();
    await waitUntil(() => streams.openCounts().total === 0);
  });
  afterAll(() => api.teardown());

  it('nudges the owner with the row id and nobody else', async () => {
    const mine = await open('u1');
    const other = await open('u2');
    await notify('u1', 'group-a');
    const frame = await mine.next('notification');
    const row = await api.notifications.findOne({ user: people.u1.id }).lean();
    expect(frame.data).toEqual({ id: uuidStr(row?._id) });
    await quiet();
    expect(
      other.messages.filter((message) => message.event === 'notification'),
    ).toEqual([]);
  });

  it('nudges again when the same group merges, and every open tab of the owner', async () => {
    const first = await open('u1');
    const second = await open('u1');
    await notify('u1', 'group-a');
    await notify('u1', 'group-a');
    for (const tab of [first, second]) {
      await tab.next('notification');
      await tab.next('notification');
    }
  });

  it('caps user streams on their own and keeps room for submission streams on the same address', async () => {
    await open('u1');
    await open('u2');
    await open('u3');
    const extra = await open('u4');
    expect(extra.status).toBe(429);
    expect(await extra.body).toContain('rate_limited');
    const feed = await open(null, '/api/internal/events/submissions');
    expect(feed.status).toBe(200);
    const ticketFeed = await open('u1', '/api/internal/events/tickets');
    expect(ticketFeed.status).toBe(200);
  });

  it('closes every tab of a session once the session is gone, and only that session', async () => {
    const tabs = [await open('u1'), await open('u1')];
    const survivor = await open('u2');
    const { cookie } = people.u1.session;
    const sessionId = cookie.slice(cookie.indexOf('=') + 1);
    await api.sessions.destroy(sessionId);
    await Promise.all(tabs.map((tab) => tab.closed));
    await quiet();
    expect(survivor.status).toBe(200);
    expect(streams.openCounts().userStreams).toBe(1);
    people.u1.session = await loginAs(api, people.u1.id);
  });
});
