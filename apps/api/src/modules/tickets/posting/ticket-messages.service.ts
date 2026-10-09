import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { ticketMessageDescription, ticketPath } from '@libs/community';
import { newId } from '@libs/database';
import { DiscordWebhooksService } from '../../discord/discord-webhooks.service';
import { renderField } from '../../problems/editing/problem-markup';
import type { TicketMessageResponse } from '../core/dto/ticket.response';
import {
  TICKET_MESSAGE_LIMIT,
  TICKET_WINDOW_SECONDS,
} from '../core/rate-limits';
import { TicketAccess } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketGateService } from '../core/ticket-gate.service';
import { TicketResponsesService } from '../core/ticket-responses.service';
import { TicketsRepository } from '../core/tickets.repository';
import { TicketEventsService } from '../streams/ticket-events.service';

/** Legacy `TicketView.form_valid`: anyone who may read the ticket answers, closed or not, unless muted. */
@Injectable()
export class TicketMessagesService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly context: TicketContextService,
    private readonly gate: TicketGateService,
    private readonly rateLimits: RateLimitService,
    private readonly responses: TicketResponsesService,
    private readonly events: TicketEventsService,
    private readonly discord: DiscordWebhooksService,
  ) {}

  async post(
    principal: Principal,
    ticketId: string,
    body: string,
  ): Promise<TicketMessageResponse> {
    await this.gate.assertCanWrite(principal);
    await this.context.accessible(principal, ticketId);
    const bodyHtml = renderField(body, 'user', 'body');
    const releaseHit = await this.rateLimits.reserve(
      [`ticket-message:${principal.userId}`],
      TICKET_MESSAGE_LIMIT,
      TICKET_WINDOW_SECONDS,
    );
    const message = {
      _id: newId(),
      user: principal.userId,
      body,
      bodyHtml,
      createdAt: new Date(),
    };
    try {
      if (
        !(await this.tickets.pushMessage(
          ticketId,
          message,
          TicketAccess.isStaff(principal),
        ))
      )
        throw new AppError(
          'conflict',
          409,
          'This ticket reached its limit of 500 messages',
        );
    } catch (error) {
      await releaseHit();
      throw error;
    }
    await this.events.publish({
      type: 'ticket-message',
      ticketId,
      messageId: message._id,
      open: null,
    });
    await this.discord.notify('on_new_ticket_message', {
      title: `New ticket reply on ${this.discord.link(ticketPath(ticketId))}`,
      description: ticketMessageDescription(body),
      author: this.discord.author(principal.username),
    });
    return this.responses.messageOf(message);
  }
}
