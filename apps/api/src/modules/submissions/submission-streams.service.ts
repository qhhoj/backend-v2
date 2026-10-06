import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { PrincipalService, SessionService, UsersRepository } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { uuidStr } from '@libs/database';
import { parseSubmissionEvent, SUBMISSION_EVENTS_CHANNEL } from '@libs/judging';
import type { SubmissionEvent } from '@libs/judging';
import { ProblemEvents } from '../problems/problem.events';
import { ProblemsRepository } from '../problems/problems.repository';
import { STREAM_LIMITS } from './rate-limits';
import type { StreamLimits } from './rate-limits';
import { HEARTBEAT_FRAME, openEventStream, sseFrame } from './sse';
import type { EventStream } from './sse';
import { SubmissionsRepository } from './submissions.repository';
import type { SubmissionState } from './submissions.repository';
import { SubmissionsService } from './submissions.service';

/** How long the feed trusts a problem's publicity; a `publicityChanged` in this process drops it at once. */
const FEED_PROBLEM_TTL_MS = 30_000;
const FEED_PROBLEM_CACHE_SIZE = 10_000;

interface OpenStream {
  stream: EventStream;
  /** Null on the public feed. */
  submissionId: string | null;
  auth: AuthContext | null;
  /** Submission streams: test-case progress only when the viewer sees every case result. */
  caseEvents: boolean;
}

const increment = (counts: Map<string, number>, key: string) =>
  counts.set(key, (counts.get(key) ?? 0) + 1);
const decrement = (counts: Map<string, number>, key: string) => {
  const left = (counts.get(key) ?? 0) - 1;
  if (left > 0) counts.set(key, left);
  else counts.delete(key);
};

/** What a stream starts with, so a page that reconnects never misses the end. */
const stateOf = (submission: SubmissionState, caseEvents: boolean) => ({
  submissionId: uuidStr(submission._id),
  status: submission.status,
  result: submission.result,
  points: submission.points,
  casePoints: submission.casePoints,
  caseTotal: submission.caseTotal,
  // The progress `test-case` events carry, withheld like them.
  currentTestcase: caseEvents ? submission.currentTestcase : null,
});

/** Live submission events over SSE: one Redis subscription per api process fans `submission-events` out to the open streams, capped per user, per IP and in total, dropped when they stop reading, and re-authorised every `recheckMs`. */
@Injectable()
export class SubmissionStreamsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubmissionStreamsService.name);
  private subscriber: Redis | null = null;
  /** Whether the Redis subscription is confirmed; false from the moment the connection drops. */
  private subscribed = false;
  private subscriptionLost = false;
  private readonly bySubmission = new Map<string, Set<OpenStream>>();
  private readonly feed = new Set<OpenStream>();
  private readonly perUser = new Map<string, number>();
  private readonly perIp = new Map<string, number>();
  private total = 0;
  private readonly feedProblems = new Map<
    string,
    { eligible: boolean; expiresAt: number }
  >();
  /** Feed deliveries run one after another, so a cache miss never reorders events. */
  private feedQueue: Promise<void> = Promise.resolve();
  private heartbeatTimer?: NodeJS.Timeout;
  private recheckTimer?: NodeJS.Timeout;
  private rechecking = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
    private readonly submissions: SubmissionsService,
    private readonly submissionRows: SubmissionsRepository,
    private readonly problems: ProblemsRepository,
    private readonly problemEvents: ProblemEvents,
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
  ) {}

  /** Subscribe mode blocks its connection, so the subscriber is never the shared client. ioredis reconnects; once the subscription is confirmed again, open streams are told to `resync`, because events published meanwhile are lost. */
  async onModuleInit(): Promise<void> {
    const subscriber = new Redis(this.env.redisUrl, {
      maxRetriesPerRequest: null,
    });
    subscriber.on('error', (error: Error) =>
      this.logger.error(`Submission events subscription: ${error.message}`),
    );
    subscriber.on('message', (_channel: string, raw: string) =>
      this.deliver(raw),
    );
    subscriber.on('close', () => {
      if (this.subscribed) this.subscriptionLost = true;
      this.subscribed = false;
    });
    subscriber.on('ready', () => void this.confirmResubscription(subscriber));
    this.subscriber = subscriber;
    await subscriber.subscribe(SUBMISSION_EVENTS_CHANNEL);
    this.subscribed = true;
    // `pointsChanged` also covers the organisation-private flag.
    for (const name of ['publicityChanged', 'pointsChanged'] as const)
      this.problemEvents.on(name, (problemId) =>
        this.feedProblems.delete(problemId),
      );
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
    const streams = this.allStreams();
    for (const entry of streams) entry.stream.close();
    await Promise.all(streams.map((entry) => entry.stream.closed));
    const { subscriber } = this;
    this.subscriber = null;
    this.subscribed = false;
    subscriber?.removeAllListeners('message');
    await subscriber?.quit().catch(() => subscriber.disconnect());
  }

  isSubscribed(): boolean {
    return this.subscribed;
  }

  /** The caps first (429: refused clients skip the detail lookups), then the detail rules (404, 403), then the stream. `state` is read after the stream is registered, so an event published during the lookups is either in it or delivered after it; it may follow an event that already reached the stream, and clients treat the latest status as current. */
  async openSubmission(
    auth: AuthContext,
    submissionId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const release = this.reserve(request.ip, auth.principal.userId);
    let entry: OpenStream;
    try {
      const { submission, caseEvents } = await this.submissions.streamAccess(
        auth.principal,
        submissionId,
      );
      entry = this.open(reply, release, {
        submissionId: uuidStr(submission._id),
        auth,
        caseEvents,
      });
    } catch (error) {
      release();
      throw error;
    }
    try {
      const state = await this.submissionRows.findState(entry.submissionId!);
      if (!state) return entry.stream.close();
      entry.stream.send(sseFrame('state', stateOf(state, entry.caseEvents)));
    } catch (error) {
      this.logger.error(
        `Reading a stream's state failed: ${(error as Error).message}`,
      );
      entry.stream.close();
    }
  }

  openFeed(request: FastifyRequest, reply: FastifyReply): void {
    if (this.feed.size >= this.limits.feedTotal)
      throw new AppError('rate_limited', 429, 'Too many open event streams');
    const release = this.reserve(request.ip, null);
    try {
      this.open(reply, release, {
        submissionId: null,
        auth: null,
        caseEvents: false,
      });
    } catch (error) {
      release();
      throw error;
    }
  }

  /** Everything is zero (one subscriber listener) once every client left. */
  openCounts() {
    return {
      total: this.total,
      users: this.perUser.size,
      ips: this.perIp.size,
      submissions: this.bySubmission.size,
      feed: this.feed.size,
      subscriberListeners: this.subscriber?.listenerCount('message') ?? 0,
    };
  }

  /** Takes over the reply; `release` (from `reserve`) runs once when the stream closes. If this throws, the caller still owns `release`. */
  private open(
    reply: FastifyReply,
    release: () => void,
    fields: Omit<OpenStream, 'stream'>,
  ): OpenStream {
    const entry: OpenStream = {
      stream: openEventStream(reply, this.limits.maxBufferedBytes),
      ...fields,
    };
    if (entry.submissionId === null) this.feed.add(entry);
    else {
      const listeners =
        this.bySubmission.get(entry.submissionId) ?? new Set<OpenStream>();
      listeners.add(entry);
      this.bySubmission.set(entry.submissionId, listeners);
    }
    void entry.stream.closed.then(() => {
      this.forget(entry);
      release();
    });
    return entry;
  }

  /** Throws 429 before anything is written; the returned release is idempotent. */
  private reserve(ip: string, userId: string | null): () => void {
    if (
      this.total >= this.limits.total ||
      (this.perIp.get(ip) ?? 0) >= this.limits.perIp ||
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

  /** After a reconnect the subscription is confirmed (the reply to `subscribe`) before clients are told to refetch, or an event could still slip between their refetch and it. */
  private async confirmResubscription(subscriber: Redis): Promise<void> {
    if (!this.subscriptionLost) return;
    try {
      await subscriber.subscribe(SUBMISSION_EVENTS_CHANNEL);
    } catch (error) {
      this.logger.error(`Resubscribing failed: ${(error as Error).message}`);
      return;
    }
    this.subscribed = true;
    this.subscriptionLost = false;
    this.broadcast(sseFrame('resync', {}));
  }

  private forget(entry: OpenStream): void {
    if (entry.submissionId === null) {
      this.feed.delete(entry);
      return;
    }
    const listeners = this.bySubmission.get(entry.submissionId);
    listeners?.delete(entry);
    if (listeners?.size === 0) this.bySubmission.delete(entry.submissionId);
  }

  /** A snapshot: closing a stream removes it later, never during the loop. */
  private allStreams(): OpenStream[] {
    return [
      ...this.feed,
      ...[...this.bySubmission.values()].flatMap((listeners) => [...listeners]),
    ];
  }

  private broadcast(frame: string): void {
    for (const entry of this.allStreams()) entry.stream.send(frame);
  }

  /** One frame per event, written to every matching stream: viewers of the submission get every event (progress only with `caseEvents`); the feed gets ids and status of public, non-organisation-private problems, without progress. */
  private deliver(raw: string): void {
    const event = parseSubmissionEvent(raw);
    if (!event) return;
    const frame = sseFrame(event.type, event);
    for (const entry of this.bySubmission.get(event.submissionId) ?? [])
      if (event.type !== 'test-case' || entry.caseEvents)
        entry.stream.send(frame);
    if (this.feed.size && event.type !== 'test-case')
      this.feedQueue = this.feedQueue.then(() => this.deliverToFeed(event));
  }

  private async deliverToFeed(event: SubmissionEvent): Promise<void> {
    try {
      if (!(await this.isFeedProblem(event.problemId))) return;
    } catch (error) {
      this.logger.error(
        `Public feed lookup failed: ${(error as Error).message}`,
      );
      return;
    }
    const { submissionId, userId, problemId, type, status } = event;
    const frame = sseFrame(type, {
      submissionId,
      userId,
      problemId,
      type,
      status,
    });
    for (const entry of this.feed) entry.stream.send(frame);
  }

  private async isFeedProblem(problemId: string): Promise<boolean> {
    const cached = this.feedProblems.get(problemId);
    if (cached && cached.expiresAt > Date.now()) return cached.eligible;
    const problem = await this.problems.findPublicity(problemId);
    const eligible =
      problem !== null && problem.isPublic && !problem.isOrganizationPrivate;
    if (this.feedProblems.size >= FEED_PROBLEM_CACHE_SIZE)
      this.feedProblems.clear();
    this.feedProblems.set(problemId, {
      eligible,
      expiresAt: Date.now() + FEED_PROBLEM_TTL_MS,
    });
    return eligible;
  }

  /** Every `recheckMs`: the guard's checks again, then the detail rules; a viewer who lost either is disconnected. A tick still running when the next fires is skipped. */
  private async recheck(): Promise<void> {
    if (this.rechecking) return;
    this.rechecking = true;
    try {
      for (const entry of this.allStreams())
        if (entry.submissionId !== null)
          await this.reauthorize(entry, entry.submissionId);
    } finally {
      this.rechecking = false;
    }
  }

  /** A 403/404 now closes the stream; an infrastructure error keeps it (logged) until the next tick. */
  private async reauthorize(
    entry: OpenStream,
    submissionId: string,
  ): Promise<void> {
    try {
      const principal = entry.auth && (await this.currentPrincipal(entry.auth));
      if (!principal) return entry.stream.close();
      entry.caseEvents = (
        await this.submissions.streamAccess(principal, submissionId)
      ).caseEvents;
    } catch (error) {
      if (error instanceof AppError) entry.stream.close();
      else
        this.logger.error(
          `Re-checking a submission stream failed: ${(error as Error).message}`,
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
