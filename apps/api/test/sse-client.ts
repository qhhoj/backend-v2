import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventStreamHubService } from '../src/modules/events/event-stream-hub.service';
import { ContestStreamsService } from '../src/modules/contests/announcements/contest-streams.service';
import { SubmissionStreamsService } from '../src/modules/submissions/streams/submission-streams.service';
import { TicketStreamsService } from '../src/modules/tickets/streams/ticket-streams.service';
import { UserStreamsService } from '../src/modules/notifications/streams/user-streams.service';
import type { ApiTest } from './setup';

/** Open stream counts of the hub and both channels, and whether Redis confirmed the subscription. */
export const streamsOf = ({ app }: ApiTest) => {
  const hub = app.get(EventStreamHubService);
  const submissions = app.get(SubmissionStreamsService);
  const contests = app.get(ContestStreamsService);
  const tickets = app.get(TicketStreamsService);
  const users = app.get(UserStreamsService);
  return {
    openCounts: () => ({
      ...hub.openCounts(),
      ...submissions.openCounts(),
      ...contests.openCounts(),
      ...tickets.openCounts(),
      ...users.openCounts(),
    }),
    isSubscribed: () => hub.isSubscribed(),
    onModuleDestroy: () => hub.onModuleDestroy(),
  };
};

export interface SseMessage {
  event: string;
  data: unknown;
}

export interface SseClient {
  status: number;
  /** The body of a refused stream (status other than 200), once it ended. */
  body: Promise<string>;
  /** Received and not yet taken by `next`. */
  messages: SseMessage[];
  pings(): number;
  /** Takes the oldest unread message of that event, waiting for it. */
  next(event: string, timeoutMs?: number): Promise<SseMessage>;
  /** Resolves when the connection closed. */
  closed: Promise<void>;
  close(): void;
}

/** A real HTTP client: supertest waits for the end of a body, which a stream never reaches. */
export function openStream(
  api: ApiTest,
  path: string,
  headers: Record<string, string> = {},
): Promise<SseClient> {
  const { port } = api.app.getHttpServer().address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { Accept: 'text/event-stream', ...headers },
      },
      (response) => {
        const messages: SseMessage[] = [];
        const waiters = new Set<() => void>();
        let pings = 0;
        let buffer = '';
        let body = '';
        response.setEncoding('utf8');
        response.on('error', () => undefined);
        response.on('data', (chunk: string) => {
          if (response.statusCode !== 200) {
            body += chunk;
            return;
          }
          buffer += chunk;
          for (
            let end = buffer.indexOf('\n\n');
            end !== -1;
            end = buffer.indexOf('\n\n')
          ) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (block.startsWith(':')) pings += 1;
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (event !== undefined && data !== undefined)
              messages.push({ event, data: JSON.parse(data) as unknown });
          }
          for (const wake of [...waiters]) wake();
        });
        const closed = new Promise<void>((done) =>
          response.once('close', () => done()),
        );
        resolve({
          status: response.statusCode ?? 0,
          body: closed.then(() => body),
          messages,
          pings: () => pings,
          closed,
          close: () => outgoing.destroy(),
          next: (event, timeoutMs = 3000) =>
            new Promise<SseMessage>((found, fail) => {
              const look = () => {
                const index = messages.findIndex(
                  (message) => message.event === event,
                );
                if (index === -1) return;
                waiters.delete(look);
                clearTimeout(timer);
                found(messages.splice(index, 1)[0]);
              };
              const timer = setTimeout(() => {
                waiters.delete(look);
                fail(new Error(`No ${event} event within ${timeoutMs} ms`));
              }, timeoutMs);
              waiters.add(look);
              look();
            }),
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}
