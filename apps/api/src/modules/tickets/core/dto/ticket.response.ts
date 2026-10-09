import { ApiProperty } from '@nestjs/swagger';
import { TICKET_LINK_TYPES, type TicketLinkType } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class TicketLinkResponse {
  @ApiProperty({ enum: TICKET_LINK_TYPES })
  type!: TicketLinkType;
  id!: string;
  /** The problem code; null for a general issue and for a deleted problem. */
  key!: string | null;
  /** The problem name, or the issue url. */
  title!: string;
  /** SPA path for a problem, the absolute url for a general issue; empty when the problem is gone. */
  url!: string;
}

export class TicketListItemResponse {
  id!: string;
  title!: string;
  creator!: UserSummaryResponse;
  assignees!: UserSummaryResponse[];
  link!: TicketLinkResponse;
  isOpen!: boolean;
  isContributive!: boolean;
  messageCount!: number;
  createdAt!: Date;
  lastMessageAt!: Date;
}

export class TicketMessageResponse {
  id!: string;
  author!: UserSummaryResponse;
  /** Rendered at save in the `user` style (raw HTML escaped). */
  bodyHtml!: string;
  createdAt!: Date;
}

/** What the viewer may do beyond reading and open/close. */
export class TicketPermissionsResponse {
  editNotes!: boolean;
  markGood!: boolean;
  assign!: boolean;
}

export class TicketDetailResponse extends TicketListItemResponse {
  /** Every reader sees it; `can.editNotes` says who may change it. */
  notes!: string;
  messages!: TicketMessageResponse[];
  can!: TicketPermissionsResponse;
}
