import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { PrincipalService, SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, ENV, ipMatcher } from '@libs/common';
import type { Env } from '@libs/common';
import { HEARTBEAT_FRAME, openEventStream, sseFrame } from './sse';
import type { EventStream } from './sse';
import { STREAM_LIMITS } from './stream-limits';
import type { StreamLimits } from './stream-limits';

/** A topic of live events: a Redis channel fanned out to its own streams. Registers itself in its constructor. */
export interface EventChannel {
  /** For log messages. */
  readonly name: string;
  readonly redisChannel: string;
  /** One raw Redis message; writes frames to the channel's streams. */
  deliver(raw: string): void;
  /** The stream closed: drop it from the channel's indexes. */
  forget(entry: OpenStream): void;
  /** Every `recheckMs`, after the session is confirmed (`principal` is null for anonymous viewers): close the stream if its access rules no longer hold. A thrown `AppError` closes it too, anything else is logged and retried next tick. Streams without it are never re-checked. */
  recheck?(entry: OpenStream, principal: Principal | null): Promise<void>;
}

export interface OpenStream {
  stream: EventStream;
  channel: EventChannel;
  /** Null for anonymous streams. */
  auth: AuthContext | null;
}

const increment = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);
const decrement = (counts: Map<string, number>, key: string) => {
  const left = (counts.get(key) ?? 0) - 1;
  if (left > 0) counts.set(key, left);
  else counts.delete(key);
};

/** Live events over SSE: one Redis subscriber per api process fans every channel out to its streams. The hub caps open streams per user, per IP and in total, drops clients that stop reading, sends heartbeats and re-authorises every `recheckMs`. */
@Injectable()
export class EventStreamHubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventStreamHubService.name);
  private readonly channels = new Map<string, EventChannel>();
  private readonly streams = new Set<OpenStream>();
  private subscriber: Redis | null = null;
  /** Whether the Redis subscription is confirmed; false from the moment the connection drops. */
  private subscribed = false;
  private subscriptionLost = false;
  private readonly perUser = new Map<string, number>();
  private readonly perIp = new Map<string, number>();
  private total = 0;
  private readonly isAllowlisted: (ip: string) => boolean;
  private heartbeatTimer?: NodeJS.Timeout;
  private recheckTimer?: NodeJS.Timeout;
  private rechecking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
  ) {
    this.isAllowlisted = ipMatcher(env.sseIpAllowlist);
  }

  /** Before `onModuleInit` (channels register in their constructors). */
  register(channel: EventChannel): void {
    this.channels.set(channel.redisChannel, channel);
  }

  /** Subscribe mode blocks its connection, so the subscriber is never the shared client. ioredis reconnects; once the subscription is confirmed again, open streams are told to `resync`, because events published meanwhile are lost. */
  async onModuleInit(): Promise<void> {
    const subscriber = new Redis(this.env.redisUrl, {
      maxRetriesPerRequest: null,
    });
    subscriber.on('error', (error: Error) =>
      this.logger.error(`Events subscription: ${error.message}`),
    );
    subscriber.on('message', (redisChannel: string, raw: string) =>
      this.channels.get(redisChannel)?.deliver(raw),
    );
    subscriber.on('close', () => {
      if (this.subscribed) this.subscriptionLost = true;
      this.subscribed = false;
    });
    subscriber.on('ready', () => void this.confirmResubscription(subscriber));
    this.subscriber = subscriber;
    await subscriber.subscribe(...this.channels.keys());
    this.subscribed = true;
    this.heartbeatTimer = setInterval(
      () => this.broadcast(HEARTBEAT_FRAME),
      this.limits.heartbeatMs,
    );
    this.recheckTimer = setInterval(
      () => void this.recheck(),
      this.limits.recheckMs,
    );
  }

  /** Open streams would keep the HTTP server from closing. Safe to call twice. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.recheckTimer);
    const open = [...this.streams];
    for (const entry of open) entry.stream.close();
    await Promise.all(open.map((entry) => entry.stream.closed));
    const { subscriber } = this;
    this.subscriber = null;
    this.subscribed = false;
    subscriber?.removeAllListeners('message');
    await subscriber?.quit().catch(() => subscriber.disconnect());
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  /** Everything is zero (one subscriber listener) once every client left. */
  openCounts() {
    return {
      total: this.total,
      users: this.perUser.size,
      ips: this.perIp.size,
      subscriberListeners: this.subscriber?.listenerCount('message') ?? 0,
    };
  }

  private ipLimit(ip: string): number {
    return this.isAllowlisted(ip)
      ? this.limits.perAllowlistedIp
      : this.limits.perIp;
  }

  /** Throws 429 before anything is written; the returned release is idempotent and goes to `open`. */
  reserve(ip: string, userId: string | null): () => void {
    if (
      this.total >= this.limits.total ||
      (this.perIp.get(ip) ?? 0) >= this.ipLimit(ip) ||
      (userId !== null &&
        (this.perUser.get(userId) ?? 0) >= this.limits.perUser)
    )
      throw new AppError('rate_limited', 429, 'Too many open event streams');
    this.total += 1;
    increment(this.perIp, ip);
    if (userId !== null) increment(this.perUser, userId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      decrement(this.perIp, ip);
      if (userId !== null) decrement(this.perUser, userId);
    };
  }

  /** Takes over the reply; `release` (from `reserve`) runs once when the stream closes, after the channel forgot it. The channel indexes the returned entry right away. If this throws, the caller still owns `release`. */
  open<Entry extends Omit<OpenStream, 'stream'>>(
    reply: FastifyReply,
    release: () => void,
    fields: Entry,
  ): Entry & { stream: EventStream } {
    const entry = {
      stream: openEventStream(reply, this.limits.maxBufferedBytes),
      ...fields,
    };
    this.streams.add(entry);
    void entry.stream.closed.then(() => {
      this.streams.delete(entry);
      entry.channel.forget(entry);
      release();
    });
    return entry;
  }

  /** After a reconnect the subscription is confirmed (the reply to `subscribe`) before clients are told to refetch, or an event could still slip between their refetch and it. */
  private async confirmResubscription(subscriber: Redis): Promise<void> {
    if (!this.subscriptionLost) return;
    try {
      await subscriber.subscribe(...this.channels.keys());
    } catch (error) {
      this.logger.error(`Resubscribing failed: ${(error as Error).message}`);
      return;
    }
    this.subscribed = true;
    this.subscriptionLost = false;
    this.broadcast(sseFrame('resync', {}));
  }

  /** A snapshot: closing a stream removes it later, never during the loop. */
  private broadcast(frame: string): void {
    for (const entry of [...this.streams]) entry.stream.send(frame);
  }

  /** Every `recheckMs`: the session again, then the channel's rules. A tick still running when the next fires is skipped. */
  private async recheck(): Promise<void> {
    if (this.rechecking) return;
    this.rechecking = true;
    try {
      for (const entry of [...this.streams]) await this.recheckStream(entry);
    } finally {
      this.rechecking = false;
    }
  }

  private async recheckStream(entry: OpenStream): Promise<void> {
    const { channel } = entry;
    if (!channel.recheck) return;
    try {
      const principal = entry.auth && (await this.currentPrincipal(entry.auth));
      if (entry.auth && !principal) return entry.stream.close();
      await channel.recheck(entry, principal);
    } catch (error) {
      if (error instanceof AppError) entry.stream.close();
      else
        this.logger.error(
          `Re-checking a ${channel.name} stream failed: ${(error as Error).message}`,
        );
    }
  }

  /** The session still exists (logout, password change and impersonation end destroy it), the user is still active, and an API token was not regenerated. */
  private async currentPrincipal(auth: AuthContext): Promise<Principal | null> {
    if (auth.sessionId !== null && !(await this.sessions.get(auth.sessionId)))
      return null;
    const user = await this.users.findById(auth.user._id);
    if (
      !user?.isActive ||
      (auth.viaToken && user.apiTokenHash !== auth.user.apiTokenHash)
    )
      return null;
    return this.principals.build(user);
  }
}
