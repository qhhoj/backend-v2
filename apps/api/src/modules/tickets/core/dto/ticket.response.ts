import { ApiProperty } from '@nestjs/swagger';
import {
  TICKET_LINK_TYPES,
  TICKET_TIMELINE_TYPES,
  type TicketLinkType,
  type TicketTimelineType,
} from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class TicketLinkResponse {
  /** problem for a ticket about a problem, general for a site issue. */
  @ApiProperty({ enum: TICKET_LINK_TYPES })
  type!: TicketLinkType;
  /** Id of the problem or issue. */
  id!: string;
  /** The problem code; null for a general issue and for a deleted problem. */
  key!: string | null;
  /** The problem name, or the issue url. */
  title!: string;
  /** SPA path for a problem, the absolute url for a general issue; empty when the problem is gone. */
  url!: string;
}

export class TicketListItemResponse {
  /** Id of the ticket. */
  id!: string;
  /** Ticket title. */
  title!: string;
  /** The user who filed the ticket. */
  creator!: UserSummaryResponse;
  /** Users assigned to handle the ticket. */
  assignees!: UserSummaryResponse[];
  /** What the ticket is about. */
  link!: TicketLinkResponse;
  /** False once the ticket is closed. */
  isOpen!: boolean;
  /**
   * Marked good by staff: counts toward the creator's contribution points.
   */
  isContributive!: boolean;
  /** Number of messages. */
  messageCount!: number;
  /** When the ticket was filed, ISO 8601. */
  createdAt!: Date;
  /** When the newest message was posted, ISO 8601. */
  lastMessageAt!: Date;
}

export class TicketMessageResponse {
  /** Id of the message. */
  id!: string;
  /** The user who wrote the message. */
  author!: UserSummaryResponse;
  /** Rendered at save in the `user` style (raw HTML escaped). */
  bodyHtml!: string;
  /** When the message was posted, ISO 8601. */
  createdAt!: Date;
}

/** What the viewer may do beyond reading and open/close. */
export class TicketPermissionsResponse {
  /** The caller may edit the notes. */
  editNotes!: boolean;
  /** The caller may mark the ticket good. */
  markGood!: boolean;
  /** The caller may change the assignees. */
  assign!: boolean;
}

/** A state change of the ticket, shown between the messages. */
export class TicketTimelineEventResponse {
  /** Id of the event. */
  id!: string;
  @ApiProperty({ enum: TICKET_TIMELINE_TYPES, enumName: 'TicketTimelineType' })
  type!: TicketTimelineType;
  /** The user who made the change. */
  actor!: UserSummaryResponse;
  /** The assignee of `assigned` / `unassigned`, else null. */
  target!: UserSummaryResponse | null;
  /** When the change was made, ISO 8601. */
  at!: Date;
}

/** One row of the thread: exactly one of `message` and `event` is set, matching `kind`. */
export class TicketTimelineEntryResponse {
  /** message or event; the matching property is set and the other is null. */
  kind!: 'message' | 'event';
  /** When the entry happened, ISO 8601. */
  at!: Date;
  /** The message, when kind is message. */
  message!: TicketMessageResponse | null;
  /** The state change, when kind is event. */
  event!: TicketTimelineEventResponse | null;
}

export class TicketDetailResponse extends TicketListItemResponse {
  /** Every reader sees it; `can.editNotes` says who may change it. */
  notes!: string;
  /** The ticket's messages, oldest first. */
  messages!: TicketMessageResponse[];
  /** Messages and state changes by time (equal instants: message first). */
  timeline!: TicketTimelineEntryResponse[];
  /** What the caller may do with the ticket. */
  can!: TicketPermissionsResponse;
}
