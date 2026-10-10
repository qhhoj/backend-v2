import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { mergeTimeline } from '@libs/community';
import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { TicketMessage, TicketTimelineEvent } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import type {
  TicketDetailResponse,
  TicketTimelineEventResponse,
  TicketLinkResponse,
  TicketListItemResponse,
  TicketMessageResponse,
  TicketTimelineEntryResponse,
} from './dto/ticket.response';
import { TicketAccess } from './ticket-access';
import type { TicketAccessView } from './ticket-access';
import { TicketContextService } from './ticket-context.service';
import type { TicketDocument } from './tickets.repository';

type People = Map<string, UserSummaryResponse>;

/** Builds the wire shapes: one users lookup and one links lookup per response, however many tickets. */
@Injectable()
export class TicketResponsesService {
  constructor(
    private readonly users: UsersRepository,
    private readonly context: TicketContextService,
  ) {}

  async items(tickets: TicketDocument[]): Promise<TicketListItemResponse[]> {
    const [people, links] = await Promise.all([
      this.people(tickets),
      this.context.links(tickets),
    ]);
    return tickets.map((ticket) => this.item(ticket, people, links));
  }

  async detail(
    principal: Principal,
    ticket: TicketDocument,
    view: TicketAccessView,
  ): Promise<TicketDetailResponse> {
    const [people, links] = await Promise.all([
      this.people([ticket]),
      this.context.links([ticket]),
    ]);
    const can = {
      editNotes: TicketAccess.canEditNotes(principal, view),
      markGood: TicketAccess.canMarkGood(principal, view),
      assign: TicketAccess.canAssign(principal),
    };
    const messages = (ticket.messages ?? []).map((message) =>
      this.message(message, people),
    );
    return {
      ...this.item(ticket, people, links),
      notes: ticket.notes,
      can,
      messages,
      timeline: this.timeline(messages, ticket.events ?? [], people),
    };
  }

  /** A message just written. */
  async messageOf(message: TicketMessage): Promise<TicketMessageResponse> {
    const people = new Map(
      (await this.users.findByIds([uuidStr(message.user)])).map((user) => [
        user._id,
        UserSummaryResponse.from(user),
      ]),
    );
    return this.message(message, people);
  }

  private item(
    ticket: TicketDocument,
    people: People,
    links: Map<string, TicketLinkResponse>,
  ): TicketListItemResponse {
    const id = uuidStr(ticket._id);
    return {
      id,
      title: ticket.title,
      creator: this.person(people, uuidStr(ticket.user)),
      assignees: ticket.assignees.map((assignee) =>
        this.person(people, uuidStr(assignee)),
      ),
      link: links.get(id)!,
      isOpen: ticket.isOpen,
      isContributive: ticket.isContributive,
      messageCount: ticket.messageCount,
      createdAt: ticket.createdAt,
      lastMessageAt: ticket.lastMessageAt,
    };
  }

  /** Messages and events by time; a ticket that predates the timeline has no events. */
  private timeline(
    messages: TicketMessageResponse[],
    events: TicketTimelineEvent[],
    people: People,
  ): TicketTimelineEntryResponse[] {
    const merged = mergeTimeline(
      messages,
      events.map((event) => this.event(event, people)),
    );
    return merged.map((entry): TicketTimelineEntryResponse =>
      entry.kind === 'message'
        ? { kind: 'message', at: entry.at, message: entry.message, event: null }
        : { kind: 'event', at: entry.at, message: null, event: entry.event },
    );
  }

  private event(
    event: TicketTimelineEvent,
    people: People,
  ): TicketTimelineEventResponse {
    return {
      id: uuidStr(event._id),
      type: event.type,
      actor: this.person(people, uuidStr(event.user)),
      target: event.target ? this.person(people, uuidStr(event.target)) : null,
      at: event.at,
    };
  }

  private message(
    message: TicketMessage,
    people: People,
  ): TicketMessageResponse {
    return {
      id: uuidStr(message._id),
      author: this.person(people, uuidStr(message.user)),
      bodyHtml: message.bodyHtml,
      createdAt: message.createdAt,
    };
  }

  /** A deleted user keeps their text. */
  private person(people: People, id: string): UserSummaryResponse {
    return people.get(id) ?? { id, username: 'deleted', rating: null };
  }

  private async people(tickets: TicketDocument[]): Promise<People> {
    const ids = unique(
      tickets.flatMap((ticket) => [
        uuidStr(ticket.user),
        ...ticket.assignees.map(uuidStr),
        ...(ticket.messages ?? []).map((message) => uuidStr(message.user)),
        ...(ticket.events ?? []).flatMap((event) => [
          uuidStr(event.user),
          ...(event.target ? [uuidStr(event.target)] : []),
        ]),
      ]),
    );
    return new Map(
      (await this.users.findByIds(ids)).map((user) => [
        user._id,
        UserSummaryResponse.from(user),
      ]),
    );
  }
}
