import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@libs/common';
import type { FeedEvent } from '@libs/contests';
import { EventStreamHubService } from '../../events/event-stream-hub.service';
import { STREAM_LIMITS } from '../../events/stream-limits';
import type { StreamLimits } from '../../events/stream-limits';
import { FeedAuthService } from './feed-auth.service';
import type { FeedContext } from './feed-auth.service';
import { FeedService, newFeedSession } from './feed.service';
import type { FeedSession } from './feed.service';

export const FEED_STREAM_OPTIONS = Symbol('FEED_STREAM_OPTIONS');
export interface FeedStreamOptions {
  /** How often a stream re-checks its key and reads the changed submissions: ten seconds is plenty for a resolver, and a tick still costs a few queries. */
  intervalMs: number;
  /** A blank line this often on a quiet stream, so a dead peer is noticed (resolvers ignore blank lines). */
  keepAliveMs: number;
}
export const DEFAULT_FEED_STREAM_OPTIONS: FeedStreamOptions = {
  intervalMs: 10_000,
  keepAliveMs: 30_000,
};
/** A resolver needs one or two. */
export const FEED_STREAMS_PER_KEY = 2;

const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Accel-Buffering': 'no',
} as const;

/** What one open stream remembers. */
interface StreamState {
  context: FeedContext;
  session: FeedSession;
  sent: Set<string>;
  nextToken: number;
}

/** What was sent, by content: a changed event (a re-judged submission, the state) is sent again, an unchanged one never. */
const digestOf = (event: FeedEvent): string =>
  createHash('sha1')
    .update(JSON.stringify([event.type, event.id, event.data]))
    .digest('base64');

@Injectable()
export class FeedStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(FeedStreamService.name);
  private readonly openByKey = new Map<string, number>();
  /** Open feed streams of this process, held under the hub's `feedTotal`. */
  private openCount = 0;
  /** Hijacked responses keep the HTTP server from closing: shutdown ends every one. */
  private readonly responses = new Set<ServerResponse>();

  constructor(
    private readonly hub: EventStreamHubService,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
    @Inject(FEED_STREAM_OPTIONS) private readonly options: FeedStreamOptions,
    private readonly auth: FeedAuthService,
    private readonly feeds: FeedService,
  ) {}

  /** Everything that can fail runs before the reply is taken over: the key, the hub caps (per IP and in total), the per-key cap, the first snapshot. */
  async open(
    request: FastifyRequest,
    reply: FastifyReply,
    contestKey: string,
  ): Promise<void> {
    const context = await this.auth.authorize(
      { authorization: request.headers.authorization, ip: request.ip },
      contestKey,
    );
    const release = this.reserve(request.ip, context.feedKey.id);
    try {
      const session = newFeedSession();
      const first = await this.feeds.eventsFor(context, new Date(), session);
      this.begin(
        reply,
        {
          context,
          session,
          sent: new Set(first.map(digestOf)),
          nextToken: first.length + 1,
        },
        first,
        release,
      );
    } catch (error) {
      release();
      throw error;
    }
  }

  onModuleDestroy(): void {
    for (const response of [...this.responses]) response.destroy();
  }

  private reserve(ip: string, keyId: string): () => void {
    const holding = this.openByKey.get(keyId) ?? 0;
    if (this.openCount >= this.limits.feedTotal)
      throw new AppError('rate_limited', 429, 'Too many open feed streams');
    if (holding >= FEED_STREAMS_PER_KEY)
      throw new AppError(
        'rate_limited',
        429,
        'Too many open feed streams for this key',
      );
    const releaseHub = this.hub.reserve(ip, null);
    this.openByKey.set(keyId, holding + 1);
    this.openCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseHub();
      this.openCount -= 1;
      const left = (this.openByKey.get(keyId) ?? 1) - 1;
      if (left > 0) this.openByKey.set(keyId, left);
      else this.openByKey.delete(keyId);
    };
  }

  private begin(
    reply: FastifyReply,
    state: StreamState,
    first: FeedEvent[],
    release: () => void,
  ): void {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, STREAM_HEADERS);
    this.responses.add(response);
    response.write(this.feeds.ndjson(first));
    let isBusy = false;
    const timer = setInterval(() => {
      if (isBusy) return;
      isBusy = true;
      void this.push(response, state).finally(() => {
        isBusy = false;
      });
    }, this.options.intervalMs);
    const keepAlive = setInterval(
      () => response.write('\n'),
      this.options.keepAliveMs,
    );
    response.once('close', () => {
      clearInterval(timer);
      clearInterval(keepAlive);
      this.responses.delete(response);
      release();
    });
  }

  /** One tick: the new events, or the end of the stream when the key stopped qualifying. */
  private async push(
    response: ServerResponse,
    state: StreamState,
  ): Promise<void> {
    try {
      const events = await this.tick(state);
      if (events.length) response.write(this.feeds.ndjson(events));
      if (response.writableLength > this.limits.maxBufferedBytes)
        response.destroy();
    } catch (error) {
      if (!(error instanceof AppError))
        this.logger.error(
          `Feed stream tick failed: ${(error as Error).message}`,
        );
      response.end();
    }
  }

  /** The key and its owner are checked again; then the events not sent yet, numbered on from the last token. Only submissions changed since the last tick are read. */
  private async tick(state: StreamState): Promise<FeedEvent[]> {
    const fresh = await this.auth.reauthorize(
      state.context.contest._id,
      state.context.feedKey.id,
    );
    const latest = await this.feeds.eventsFor(fresh, new Date(), state.session);
    const added = latest.filter((event) => !state.sent.has(digestOf(event)));
    for (const event of added) state.sent.add(digestOf(event));
    const numbered = added.map((event, index) => ({
      ...event,
      token: String(state.nextToken + index),
    }));
    state.nextToken += added.length;
    return numbered;
  }
}
