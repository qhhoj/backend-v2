import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketIdParamDto } from '../core/dto/ticket-params.dto';
import { TicketMessageResponse } from '../core/dto/ticket.response';
import { NewTicketMessageDto } from './dto/new-ticket.dto';
import { TicketMessagesService } from './ticket-messages.service';

@ApiTags('Tickets')
@Controller('api/internal/tickets/:id/messages')
export class TicketMessagesController {
  constructor(private readonly messages: TicketMessagesService) {}

  /**
   * Reply to a ticket
   *
   * @remarks
   * Adds a message to a ticket the caller can read, open or closed. Muted
   * users are refused (403 `forbidden`, issue code `muted`). Limited to 30
   * messages per 10 minutes (429 `rate_limited`); a ticket holds at most 500
   * messages (409 `conflict`). The message is pushed on the event stream,
   * announced on Discord and sent to the owner and assignees.
   */
  @Post()
  post(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
    @Body() { body }: NewTicketMessageDto,
  ): Promise<TicketMessageResponse> {
    return this.messages.post(auth.principal, id, body);
  }
}
