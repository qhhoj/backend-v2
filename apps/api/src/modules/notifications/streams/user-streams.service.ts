import { Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import {
  NOTIFICATION_EVENTS_CHANNEL,
  parseNotificationEvent,
} from '@libs/community';
import type { NotificationEvent } from '@libs/community';
import { EventStreamHubService } from '../../events/event-stream-hub.service';
import type {
  EventChannel,
  OpenStream,
} from '../../events/event-stream-hub.service';
import { sseFrame } from '../../events/sse';
import { STREAM_LIMITS } from '../../events/stream-limits';
import type { StreamLimits } from '../../events/stream-limits';
import { NotificationEventResponse } from './dto/notification-frame.response';

interface UserStream extends OpenStream {
  userId: string;
}

/** The `data` of a `notification` frame: the row id, never the owner. The documented `NotificationFrame` is pinned to this result. */
export function notificationFrameData(
  event: NotificationEvent,
): NotificationEventResponse {
  return { id: event.id };
}

/** The `notification-events` channel: a `notification` frame (the row id only) to every open `user` stream of the row's owner. Contest announcements send no nudge (the contest stream already shows them). */
@Injectable()
export class UserStreamsService implements EventChannel {
  readonly name = 'user';
  readonly redisChannel = NOTIFICATION_EVENTS_CHANNEL;
  private readonly byUser = new Map<string, Set<UserStream>>();
  private open = 0;

  constructor(
    private readonly hub: EventStreamHubService,
    @Inject(STREAM_LIMITS) private readonly limits: StreamLimits,
  ) {
    hub.register(this);
  }

  /** The `userTotal` cap first, then IP/user/total; nothing is sent until an event (the page fetches the count itself). */
  openUser(
    auth: AuthContext,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (this.open >= this.limits.userTotal)
      throw new AppError('rate_limited', 429, 'Too many open event streams');
    const { userId } = auth.principal;
    const release = this.hub.reserve(request.ip, userId);
    try {
      const entry = this.hub.open(reply, release, {
        channel: this,
        auth,
        userId,
      });
      const listeners = this.byUser.get(userId) ?? new Set<UserStream>();
      listeners.add(entry);
      this.byUser.set(userId, listeners);
      this.open += 1;
    } catch (error) {
      release();
      throw error;
    }
  }

  openCounts() {
    return { userStreams: this.open };
  }

  deliver(raw: string): void {
    const event = parseNotificationEvent(raw);
    if (!event) return;
    const frame = sseFrame('notification', notificationFrameData(event));
    for (const entry of this.byUser.get(event.userId) ?? [])
      entry.stream.send(frame);
  }

  forget(entry: UserStream): void {
    const listeners = this.byUser.get(entry.userId);
    listeners?.delete(entry);
    if (listeners?.size === 0) this.byUser.delete(entry.userId);
    this.open -= 1;
  }

  /** The hub only re-checks a stream whose channel has this hook; it then closes the stream itself when the session is gone, the user inactive or an API token regenerated. A user stream has no other access rule. */
  recheck(): Promise<void> {
    return Promise.resolve();
  }
}
