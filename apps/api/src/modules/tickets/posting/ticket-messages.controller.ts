import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentAuth } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { TicketIdParamDto } from '../core/dto/ticket-params.dto';
import { TicketMessageResponse } from '../core/dto/ticket.response';
import { NewTicketMessageDto } from './dto/new-ticket.dto';
import { TicketMessagesService } from './ticket-messages.service';

@Controller('api/internal/tickets/:id/messages')
export class TicketMessagesController {
  constructor(private readonly messages: TicketMessagesService) {}

  @Post()
  post(
    @CurrentAuth() auth: AuthContext,
    @Param() { id }: TicketIdParamDto,
    @Body() { body }: NewTicketMessageDto,
  ): Promise<TicketMessageResponse> {
    return this.messages.post(auth.principal, id, body);
  }
}
