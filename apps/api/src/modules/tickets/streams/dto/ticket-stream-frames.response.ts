import { ApiProperty } from '@nestjs/swagger';
import { TICKET_EVENT_TYPES } from '@libs/community';
import type { TicketEventType } from '@libs/community';

/** The payload of every ticket event: ids only, the page reads the content. */
export class TicketEventResponse {
  @ApiProperty({ type: String })
  ticketId!: string;

  /** The new message on `ticket-message`, else null. */
  @ApiProperty({ type: String, nullable: true })
  messageId!: string | null;

  /** The new state on `ticket-status`, else null. */
  @ApiProperty({ type: Boolean, nullable: true })
  open!: boolean | null;
}

/** `new-ticket`, `ticket-message` and `ticket-status` on the feed and on one ticket's stream. */
export class TicketEventFrame {
  @ApiProperty({ enum: [...TICKET_EVENT_TYPES] })
  event!: TicketEventType;

  data!: TicketEventResponse;
}
