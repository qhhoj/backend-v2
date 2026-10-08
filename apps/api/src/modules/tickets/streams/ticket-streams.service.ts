import { Injectable, Logger } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthContext, Principal } from '@libs/auth';
import { parseTicketEvent, TICKET_EVENTS_CHANNEL } from '@libs/community';
import type { TicketEvent } from '@libs/community';
import { uuidStr } from '@libs/database';
import { EventStreamHubService } from '../../events/event-stream-hub.service';
import type {
  EventChannel,
  OpenStream,
} from '../../events/event-stream-hub.service';
import { sseFrame } from '../../events/sse';
import { TicketAccess } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketsRepository } from '../core/tickets.repository';

/** Events waiting for their ticket lookup; beyond this (Mongo stalled) new events are dropped and clients resync on reconnect. */
const MAX_PENDING_EVENTS = 1000;

interface TicketStream extends OpenStream {
  /** Null on the feed of every readable ticket. */
  ticketId: string | null;
  /** Refreshed by the hub's recheck: an event is judged with the viewer's current permissions. */
  principal: Principal;
}

/** The `ticket-events` channel. Access depends on the ticket (creator, assignees, linked problem), so each event reads the ticket once and every candidate stream is judged by `TicketAccess.canSee`. */
@Injectable()
export class TicketStreamsService implements EventChannel {
  readonly name = 'ticket';
  readonly redisChannel = TICKET_EVENTS_CHANNEL;
  private readonly logger = new Logger(TicketStreamsService.name);
  private readonly feed = new Set<TicketStream>();
  private readonly byTicket = new Map<string, Set<TicketStream>>();
  /** Deliveries run one after another, so a lookup never reorders events. */
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly hub: EventStreamHubService,
    private readonly context: TicketContextService,
    private readonly tickets: TicketsRepository,
  ) {
    hub.register(this);
  }

  openFeed(
    auth: AuthContext,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const release = this.hub.reserve(request.ip, auth.principal.userId);
    try {
      this.register(
        this.hub.open(reply, release, {
          channel: this,
          auth,
          ticketId: null,
          principal: auth.principal,
        }),
      );
    } catch (error) {
      release();
      throw error;
    }
  }

  /** The detail's rules first (404, 403), then the stream; nothing is sent until an event. */
  async openTicket(
    auth: AuthContext,
    ticketId: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const release = this.hub.reserve(request.ip, auth.principal.userId);
    try {
      const { ticket } = await this.context.accessible(
        auth.principal,
        ticketId,
      );
      this.register(
        this.hub.open(reply, release, {
          channel: this,
          auth,
          ticketId: uuidStr(ticket._id),
          principal: auth.principal,
        }),
      );
    } catch (error) {
      release();
      throw error;
    }
  }

  openCounts() {
    return {
      tickets: [...this.byTicket.values()].reduce(
        (sum, set) => sum + set.size,
        this.feed.size,
      ),
    };
  }

  deliver(raw: string): void {
    const event = parseTicketEvent(raw);
    if (!event) return;
    if (this.pending >= MAX_PENDING_EVENTS)
      return this.logger.warn('Ticket event dropped: delivery is backed up');
    this.pending += 1;
    this.queue = this.queue
      .then(() => this.dispatch(event))
      .finally(() => (this.pending -= 1));
  }

  forget(entry: TicketStream): void {
    if (entry.ticketId === null) return void this.feed.delete(entry);
    const listeners = this.byTicket.get(entry.ticketId);
    listeners?.delete(entry);
    if (listeners?.size === 0) this.byTicket.delete(entry.ticketId);
  }

  /** The viewer's permissions are refreshed; a single-ticket stream closes once the ticket is unreadable or gone (the feed just stops receiving it). */
  async recheck(
    entry: TicketStream,
    principal: Principal | null,
  ): Promise<void> {
    if (!principal) return entry.stream.close();
    entry.principal = principal;
    if (entry.ticketId === null) return;
    const ticket = await this.tickets.findById(entry.ticketId);
    if (
      !ticket ||
      !TicketAccess.canSee(principal, await this.context.accessView(ticket))
    )
      entry.stream.close();
  }

  private register(entry: TicketStream): void {
    if (entry.ticketId === null) return void this.feed.add(entry);
    const listeners =
      this.byTicket.get(entry.ticketId) ?? new Set<TicketStream>();
    listeners.add(entry);
    this.byTicket.set(entry.ticketId, listeners);
  }

  private async dispatch(event: TicketEvent): Promise<void> {
    const targets = [
      ...this.feed,
      ...(this.byTicket.get(event.ticketId) ?? []),
    ];
    if (!targets.length) return;
    try {
      const ticket = await this.tickets.findById(event.ticketId);
      if (!ticket) return;
      const view = await this.context.accessView(ticket);
      const frame = sseFrame(event.type, {
        ticketId: event.ticketId,
        messageId: event.messageId,
        open: event.open,
      });
      for (const entry of targets)
        if (TicketAccess.canSee(entry.principal, view))
          entry.stream.send(frame);
    } catch (error) {
      this.logger.error(
        `Delivering a ticket event failed: ${(error as Error).message}`,
      );
    }
  }
}
