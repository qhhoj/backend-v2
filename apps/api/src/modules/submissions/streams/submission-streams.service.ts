import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { optionalPrincipal } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { uuidStr } from '@libs/database';
import { parseSubmissionEvent, SUBMISSION_EVENTS_CHANNEL } from '@libs/judging';
import type { SubmissionEvent } from '@libs/judging';
import { EventStreamHubService } from '../../events/event-stream-hub.service';
import type {
  EventChannel,
  OpenStream,
} from '../../events/event-stream-hub.service';
import { sseFrame } from '../../events/sse';
import { STREAM_LIMITS } from '../../events/stream-limits';
import type { StreamLimits } from '../../events/stream-limits';
import { ProblemEvents } from '../../problems/core/problem.events';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import {
  VISITOR_DETAIL_LIMIT,
  VISITOR_DETAIL_WINDOW_SECONDS,
  visitorDetailKey,
} from '../core/rate-limits';
import { SubmissionsRepository } from '../core/submissions.repository';
import type { SubmissionState } from '../core/submissions.repository';
import { SubmissionsService } from '../core/submissions.service';
import type {
  SubmissionFeedEventResponse,
  SubmissionStateEventResponse,
} from './dto/submission-stream-frames.response';

/** How long the feed trusts a problem's publicity; a `publicityChanged` in this process drops it at once. */
const FEED_PROBLEM_TTL_MS = 30_000;
const FEED_PROBLEM_CACHE_SIZE = 10_000;
/** A submission's contest never changes; its few feed events share one lookup. */
const FEED_CONTEST_CACHE_SIZE = 10_000;

interface SubmissionStream extends OpenStream {
  /** Null on the public feed. */
  submissionId: string | null;
  /** Test-case progress only when the viewer sees every case result. */
  caseEvents: boolean;
}

/** What a stream starts with, so a page that reconnects never misses the end. */
export const stateOf = (
  submission: SubmissionState,
  caseEvents: boolean,
): SubmissionStateEventResponse => ({
  submissionId: uuidStr(submission._id),
  status: submission.status,
  result: submission.result,
  points: submission.points,
  casePoints: submission.casePoints,
  caseTotal: submission.caseTotal,
  // The progress `test-case` events carry, withheld like them.
  currentTestcase: caseEvents ? submission.currentTestcase : null,
});

/** What the public feed shows of an event: ids and status. */
export const feedEventOf = ({
  submissionId,
  userId,
  problemId,
  type,
  status,
}: SubmissionEvent): SubmissionFeedEventResponse => ({
  submissionId,
  userId,
  problemId,
  type,
  status,
});

/** The `submission-events` channel: one stream per watched submission and the public feed. */
@Injectable()
export class SubmissionStreamsService implements EventChannel, OnModuleInit {
  readonly name = 'submission';
  readonly redisChannel = SUBMISSION_EVENTS_CHANNEL;
  private readonly logger = new Logger(SubmissionStreamsService.name);
  private readonly bySubmission = new Map<string, Set<SubmissionStream>>();
  private readonly feed = new Set<SubmissionStream>();
  private readonly feedProblems = new Map<
    string,
    { eligible: boolean; expiresAt: number }
  >();
  private readonly feedContests = new Map<string, string | null>();
  /** Feed deliveries run one after another, so a cache miss never reorders events. */
  private feedQueue: Promise<void> = Promise.resolve();
  private feedPending = 0;
  /** Feed events were dropped since the queue last drained: the feed gets one `resync` when it does. */
  private feedDropped = false;

  constructor(
    private readonly hub: EventStreamHubService,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
    private readonly submissions: SubmissionsService,
    private readonly submissionRows: SubmissionsRepository,
    private readonly problems: ProblemsRepository,
    private readonly problemEvents: ProblemEvents,
    private readonly rateLimit: RateLimitService,
  ) {
    hub.register(this);
  }

  onModuleInit(): void {
    // `pointsChanged` also covers the organisation-private flag.
    for (const name of ['publicityChanged', 'pointsChanged'] as const)
      this.problemEvents.on(name, (problemId) =>
        this.feedProblems.delete(problemId),
      );
  }

  /** The caps first (429: refused clients skip the detail lookups), then the detail rules (404, 403), then the stream. `state` is read after the stream is registered, so an event published during the lookups is either in it or delivered after it; it may follow an event that already reached the stream, and clients treat the latest status as current. */
  async openSubmission(
    auth: AuthContext | undefined,
    submissionId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const principal = optionalPrincipal(auth);
    // A session short of its 2FA or password gate is a visitor: no user cap, and the detail page's visitor limit.
    if (!principal)
      await this.rateLimit.reserve(
        [visitorDetailKey(request.ip)],
        VISITOR_DETAIL_LIMIT,
        VISITOR_DETAIL_WINDOW_SECONDS,
      );
    const release = this.hub.reserve(request.ip, principal?.userId ?? null);
    let entry: SubmissionStream;
    try {
      const { submission, caseEvents } = await this.submissions.streamAccess(
        principal,
        submissionId,
      );
      entry = this.register(
        this.hub.open(reply, release, {
          channel: this,
          // A session short of its 2FA or password gates watches as a visitor.
          auth: principal ? auth! : null,
          submissionId: uuidStr(submission._id),
          caseEvents,
        }),
      );
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
    const release = this.hub.reserve(request.ip, null);
    try {
      this.register(
        this.hub.open(reply, release, {
          channel: this,
          auth: null,
          submissionId: null,
          caseEvents: false,
        }),
      );
    } catch (error) {
      release();
      throw error;
    }
  }

  openCounts() {
    return { submissions: this.bySubmission.size, feed: this.feed.size };
  }

  /** One frame per event, written to every matching stream: viewers of the submission get every event (progress only with `caseEvents`); the feed gets ids and status of what the anonymous submission list shows (public, non-organisation-private problems, no contest whose list is hidden), without progress. */
  deliver(raw: string): void {
    const event = parseSubmissionEvent(raw);
    if (!event) return;
    const frame = sseFrame(event.type, event);
    for (const entry of this.bySubmission.get(event.submissionId) ?? [])
      if (event.type !== 'test-case' || entry.caseEvents)
        entry.stream.send(frame);
    if (this.feed.size && event.type !== 'test-case') this.queueForFeed(event);
  }

  forget(entry: SubmissionStream): void {
    if (entry.submissionId === null) {
      this.feed.delete(entry);
      return;
    }
    const listeners = this.bySubmission.get(entry.submissionId);
    listeners?.delete(entry);
    if (listeners?.size === 0) this.bySubmission.delete(entry.submissionId);
  }

  /** The detail rules again (a visitor's stream as a visitor; the hub closes a stream whose session ended); a 403/404 closes the stream (the hub), an infrastructure error keeps it (logged) until the next tick. The feed has no rules. */
  async recheck(
    entry: SubmissionStream,
    principal: Principal | null,
  ): Promise<void> {
    if (entry.submissionId === null) return;
    entry.caseEvents = (
      await this.submissions.streamAccess(principal, entry.submissionId)
    ).caseEvents;
  }

  private register(entry: SubmissionStream): SubmissionStream {
    if (entry.submissionId === null) this.feed.add(entry);
    else {
      const listeners =
        this.bySubmission.get(entry.submissionId) ??
        new Set<SubmissionStream>();
      listeners.add(entry);
      this.bySubmission.set(entry.submissionId, listeners);
    }
    return entry;
  }

  /** Bounded like the ticket channel: lookups stalled behind a slow database drop events instead of piling them up in memory. */
  private queueForFeed(event: SubmissionEvent): void {
    if (this.feedPending >= this.limits.feedBacklog) {
      if (!this.feedDropped)
        this.logger.warn('Public feed events dropped: delivery is backed up');
      this.feedDropped = true;
      return;
    }
    this.feedPending += 1;
    this.feedQueue = this.feedQueue
      .then(() => this.deliverToFeed(event))
      .finally(() => {
        this.feedPending -= 1;
        if (this.feedPending === 0 && this.feedDropped) this.resyncFeed();
      });
  }

  /** Feed clients refetch the list: events were lost. */
  private resyncFeed(): void {
    this.feedDropped = false;
    const frame = sseFrame('resync', {});
    for (const entry of this.feed) entry.stream.send(frame);
  }

  private async deliverToFeed(event: SubmissionEvent): Promise<void> {
    try {
      if (!(await this.isFeedSubmission(event))) return;
    } catch (error) {
      this.logger.error(
        `Public feed lookup failed: ${(error as Error).message}`,
      );
      return;
    }
    const frame = sseFrame(event.type, feedEventOf(event));
    for (const entry of this.feed) entry.stream.send(frame);
  }

  /** The anonymous submission list's rules: the problem, then the contest (`SubmissionsService.hiddenByContest`), read when the event is delivered so a freeze or a closed list applies at once. */
  private async isFeedSubmission(event: SubmissionEvent): Promise<boolean> {
    if (!(await this.isFeedProblem(event.problemId))) return false;
    const contestId = await this.contestOf(event.submissionId);
    if (contestId === undefined) return false;
    return !(await this.submissions.hiddenByContest(null, {
      contestId,
      userId: event.userId,
    }));
  }

  private async contestOf(
    submissionId: string,
  ): Promise<string | null | undefined> {
    if (this.feedContests.has(submissionId))
      return this.feedContests.get(submissionId);
    const contestId = await this.submissionRows.findContestId(submissionId);
    if (contestId === undefined) return undefined;
    if (this.feedContests.size >= FEED_CONTEST_CACHE_SIZE)
      this.feedContests.clear();
    this.feedContests.set(submissionId, contestId);
    return contestId;
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
}
