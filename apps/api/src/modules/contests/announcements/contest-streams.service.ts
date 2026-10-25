import { Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { optionalPrincipal } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { CONTEST_EVENTS_CHANNEL, parseContestEvent } from '@libs/contests';
import { EventStreamHubService } from '../../events/event-stream-hub.service';
import type {
  EventChannel,
  OpenStream,
} from '../../events/event-stream-hub.service';
import { sseFrame } from '../../events/sse';
import { STREAM_LIMITS } from '../../events/stream-limits';
import type { StreamLimits } from '../../events/stream-limits';
import { ContestAnnouncementEventResponse } from './dto/contest-stream-frames.response';
import { ContestAccess } from '../core/contest-access';
import { ContestViewerService } from '../core/contest-viewer.service';
import { ContestsRepository } from '../core/contests.repository';

/** The `data` of an `announcement` event; the event name is the SSE `event:` line, not a member. */
export const announcementFrameData = (
  contestId: string,
  announcementId: string,
): ContestAnnouncementEventResponse => ({ contestId, announcementId });

interface ContestStream extends OpenStream {
  contestId: string;
}

/** The `contest-events` channel: announcement ids for everyone who sees the contest. */
@Injectable()
export class ContestStreamsService implements EventChannel {
  readonly name = 'contest';
  readonly redisChannel = CONTEST_EVENTS_CHANNEL;
  private readonly byContest = new Map<string, Set<ContestStream>>();
  private open = 0;

  constructor(
    private readonly hub: EventStreamHubService,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
    private readonly contestViewers: ContestViewerService,
    private readonly contests: ContestsRepository,
  ) {
    hub.register(this);
  }

  /** Caps first (the contest cap, then IP/user/total), then visibility (404), then the stream. Nothing is sent until an event: the page fetches the list itself on (re)connect. */
  async openContest(
    auth: AuthContext | undefined,
    key: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (this.open >= this.limits.contestTotal)
      throw new AppError('rate_limited', 429, 'Too many open event streams');
    const principal = optionalPrincipal(auth);
    // A session short of its 2FA or password gate is a visitor: it never uses its user's cap.
    const release = this.hub.reserve(request.ip, principal?.userId ?? null);
    try {
      const contest = await this.contestViewers.visibleContest(principal, key);
      const entry = this.hub.open(reply, release, {
        channel: this,
        // A session short of its 2FA or password gates watches as a visitor.
        auth: principal ? auth! : null,
        contestId: contest._id,
      });
      const listeners =
        this.byContest.get(entry.contestId) ?? new Set<ContestStream>();
      listeners.add(entry);
      this.byContest.set(entry.contestId, listeners);
      this.open += 1;
    } catch (error) {
      release();
      throw error;
    }
  }

  openCounts() {
    return { contests: this.open };
  }

  deliver(raw: string): void {
    const event = parseContestEvent(raw);
    if (!event) return;
    const frame = sseFrame(
      event.type,
      announcementFrameData(event.contestId, event.announcementId),
    );
    for (const entry of this.byContest.get(event.contestId) ?? [])
      entry.stream.send(frame);
  }

  forget(entry: ContestStream): void {
    const listeners = this.byContest.get(entry.contestId);
    listeners?.delete(entry);
    if (listeners?.size === 0) this.byContest.delete(entry.contestId);
    this.open -= 1;
  }

  /** Closes once the contest is no longer visible to the viewer (anonymous: to anyone); the session was confirmed by the hub. */
  async recheck(
    entry: ContestStream,
    principal: Principal | null,
  ): Promise<void> {
    const contest = await this.contests.findById(entry.contestId);
    if (
      !contest ||
      !ContestAccess.canSee(principal, ContestAccess.accessView(contest))
    )
      entry.stream.close();
  }
}
