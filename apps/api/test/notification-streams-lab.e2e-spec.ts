import { waitUntil } from '@libs/common/testing';
import { createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { openStream, streamsOf } from './sse-client';
import type { SseClient } from './sse-client';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const USER_EVENTS = '/api/internal/events/user';
const SEATS = 20;
const DEFAULT_PER_IP = 16;

async function signedInSeats(api: ApiTest, count: number) {
  const sessions: TestSession[] = [];
  for (let seat = 0; seat < count; seat += 1) {
    const user = await createUserWith(api, `seat${seat}`);
    sessions.push(await loginAs(api, user._id));
  }
  return sessions;
}

/** `setupApiTest` copies `env` into `process.env` and never clears it, so the second case sets the variable to blank instead of omitting it. */
describe.each([
  ['an allowlisted lab', '127.0.0.1'],
  ['an address that is not on the allowlist', ''],
])(
  'user event streams from %s (default limits, one IP)',
  (_name, allowlist) => {
    const allowlisted = allowlist !== '';
    let api: ApiTest;
    let streams: ReturnType<typeof streamsOf>;
    let sessions: TestSession[];
    const opened: SseClient[] = [];

    beforeAll(async () => {
      api = await setupApiTest({ env: { SSE_IP_ALLOWLIST: allowlist } });
      streams = streamsOf(api);
      sessions = await signedInSeats(api, SEATS);
    });
    afterAll(async () => {
      for (const client of opened) client.close();
      await waitUntil(() => streams.openCounts().total === 0);
      await api.teardown();
    });

    it('allowlisted: holds one user stream per seat and still opens submission and ticket streams; otherwise refuses the stream past 16', async () => {
      const statuses: number[] = [];
      for (const session of sessions) {
        const client = await openStream(api, USER_EVENTS, {
          Cookie: session.cookie,
        });
        opened.push(client);
        statuses.push(client.status);
      }
      const accepted = allowlisted ? SEATS : DEFAULT_PER_IP;
      expect(statuses).toEqual([
        ...Array<number>(accepted).fill(200),
        ...Array<number>(SEATS - accepted).fill(429),
      ]);
      expect(streams.openCounts().userStreams).toBe(accepted);
      if (!allowlisted) return;
      const feed = await openStream(api, '/api/internal/events/submissions');
      opened.push(feed);
      const tickets = await openStream(api, '/api/internal/events/tickets', {
        Cookie: sessions[0].cookie,
      });
      opened.push(tickets);
      expect([feed.status, tickets.status]).toEqual([200, 200]);
    });
  },
);
