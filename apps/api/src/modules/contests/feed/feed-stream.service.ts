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
import { FeedService } from './feed.service';
import { FeedRoom, unsentOf } from './feed-room';
import type { FeedSubscriber } from './feed-room';

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
/** A tick whose build fails for a reason that may pass (a database blip) is retried on the next tick; the stream ends after this many in a row. */
export const MAX_FAILED_TICKS = 3;
/** A resolver needs one or two. */
const FEED_STREAMS_PER_KEY = 2;

const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Accel-Buffering': 'no',
} as const;

const once = (action: () => void): (() => void) => {
  let isDone = false;
  return () => {
    if (isDone) return;
    isDone = true;
    action();
  };
};

@Injectable()
export class FeedStreamService implements OnModuleDestroy {
  private readonly logger = new Logger(FeedStreamService.name);
  private readonly openByKey = new Map<string, number>();
  /** Open feed streams of this process, held under `contestFeedTotal` (counted into the shared reserve for submission and ticket streams). */
  private openCount = 0;
  /** Hijacked responses keep the HTTP server from closing: shutdown ends every one. */
  private readonly responses = new Set<ServerResponse>();
  /** One room per contest with a stream open or opening. */
  private readonly rooms = new Map<string, FeedRoom>();

  constructor(
    private readonly hub: EventStreamHubService,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
    @Inject(FEED_STREAM_OPTIONS) private readonly options: FeedStreamOptions,
    private readonly auth: FeedAuthService,
    private readonly feeds: FeedService,
  ) {}

  /** Everything that can fail runs before the reply is taken over: the key, the hub caps (per IP and in total), the per-key cap, the first snapshot. A client that leaves meanwhile gives every slot back. */
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
    const room = this.joinRoom(context.contest._id);
    const subscriber: FeedSubscriber = {
      response: reply.raw,
      context,
      sent: new Map(),
      nextToken: 1,
      failedTicks: 0,
    };
    const leave = once(() => {
      clearInterval(subscriber.keepAlive);
      room.subscribers.delete(subscriber);
      this.responses.delete(reply.raw);
      this.leaveRoom(context.contest._id, room);
      release();
    });
    reply.raw.once('close', leave);
    try {
      if (reply.raw.destroyed) return leave();
      const first = unsentOf(subscriber, await room.build(context));
      if (reply.raw.destroyed) return leave();
      this.begin(reply, subscriber, room, first);
    } catch (error) {
      leave();
      throw error;
    }
  }

  onModuleDestroy(): void {
    for (const room of this.rooms.values()) clearInterval(room.timer);
    for (const response of [...this.responses]) response.destroy();
  }

  private reserve(ip: string, keyId: string): () => void {
    const holding = this.openByKey.get(keyId) ?? 0;
    if (this.openCount >= this.limits.contestFeedTotal)
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
    subscriber: FeedSubscriber,
    room: FeedRoom,
    first: FeedEvent[],
  ): void {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, STREAM_HEADERS);
    this.responses.add(response);
    response.write(this.feeds.ndjson(first));
    subscriber.keepAlive = setInterval(
      () => response.write('\n'),
      this.options.keepAliveMs,
    );
    room.subscribers.add(subscriber);
  }

  private joinRoom(contestId: string): FeedRoom {
    let room = this.rooms.get(contestId);
    if (!room) {
      room = new FeedRoom(this.feeds, this.options.intervalMs / 2);
      room.timer = setInterval(
        () => void this.tickRoom(room!),
        this.options.intervalMs,
      );
      this.rooms.set(contestId, room);
    }
    room.holders += 1;
    return room;
  }

  /** A room with no stream open or opening is dropped with its cached submissions and timer. */
  private leaveRoom(contestId: string, room: FeedRoom): void {
    room.holders -= 1;
    if (room.holders > 0) return;
    clearInterval(room.timer);
    this.rooms.delete(contestId);
  }

  /** One tick of a contest: every stream re-checks its key; the feed is built once for all of them. */
  private async tickRoom(room: FeedRoom): Promise<void> {
    if (room.isTicking) return;
    room.isTicking = true;
    try {
      const now = new Date();
      await Promise.all(
        [...room.subscribers].map((subscriber) =>
          this.push(room, subscriber, now),
        ),
      );
    } finally {
      room.isTicking = false;
    }
  }

  /** The stream's new events, or the end of the stream when its key stopped qualifying or its builds keep failing. */
  private async push(
    room: FeedRoom,
    subscriber: FeedSubscriber,
    now: Date,
  ): Promise<void> {
    const { response } = subscriber;
    try {
      const { contest, feedKey } = subscriber.context;
      const fresh = await this.auth.reauthorize(contest._id, feedKey.id, now);
      const events = unsentOf(subscriber, await room.build(fresh, now));
      subscriber.failedTicks = 0;
      if (events.length) response.write(this.feeds.ndjson(events));
      if (response.writableLength > this.limits.maxBufferedBytes)
        response.destroy();
    } catch (error) {
      if (this.isRetryable(subscriber, error)) return;
      response.end();
    }
  }

  /** A refusal (`AppError`: key revoked, contest too large) is final. Anything else is logged and given a few more ticks. */
  private isRetryable(subscriber: FeedSubscriber, error: unknown): boolean {
    if (error instanceof AppError) return false;
    subscriber.failedTicks += 1;
    this.logger.error(
      `Feed stream tick failed (${subscriber.failedTicks}/${MAX_FAILED_TICKS}): ${(error as Error).message}`,
    );
    return subscriber.failedTicks < MAX_FAILED_TICKS;
  }
}
