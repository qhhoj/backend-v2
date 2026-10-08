import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, unique } from '@libs/common';
import { ContributionPointsService } from '../../contributions/contribution-points.service';
import type { TicketDetailResponse } from '../core/dto/ticket.response';
import { TicketAccess } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketResponsesService } from '../core/ticket-responses.service';
import { TicketsRepository } from '../core/tickets.repository';
import { TicketEventsService } from '../streams/ticket-events.service';
import type { UpdateTicketDto } from './dto/update-ticket.dto';

const forbidden = (message: string) => new AppError('forbidden', 403, message);

/**
 * Legacy `TicketStatusChangeView` and `TicketNotesEditView` as one PATCH.
 * Every permission and every username is checked before the single `$set`, so a refused request writes nothing.
 * No mute check: muting blocks filing and writing messages (`TicketGateService`), not closing or editing notes.
 */
@Injectable()
export class TicketUpdatesService {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly context: TicketContextService,
    private readonly responses: TicketResponsesService,
    private readonly users: UsersRepository,
    private readonly events: TicketEventsService,
    private readonly contributions: ContributionPointsService,
  ) {}

  async update(
    principal: Principal,
    ticketId: string,
    dto: UpdateTicketDto,
  ): Promise<TicketDetailResponse> {
    const { ticket, view } = await this.context.accessible(principal, ticketId);
    if (
      dto.isContributive !== undefined &&
      !TicketAccess.canMarkGood(principal, view)
    )
      throw forbidden('Only staff can mark tickets good, and never their own');
    if (dto.notes !== undefined && !TicketAccess.canEditNotes(principal, view))
      throw forbidden('Only assignees and staff can edit notes');
    if (dto.assignees !== undefined && !TicketAccess.canAssign(principal))
      throw forbidden('Only staff can change assignees');
    const changes: Parameters<TicketsRepository['update']>[1] = {};
    if (dto.isOpen !== undefined && dto.isOpen !== ticket.isOpen)
      changes.isOpen = dto.isOpen;
    if (
      dto.isContributive !== undefined &&
      dto.isContributive !== ticket.isContributive
    )
      changes.isContributive = dto.isContributive;
    if (dto.notes !== undefined) changes.notes = dto.notes;
    if (dto.assignees !== undefined)
      changes.assignees = await this.assigneeIds(dto.assignees);
    await this.tickets.update(ticketId, changes);
    if (changes.isOpen !== undefined)
      await this.events.publish({
        type: 'ticket-status',
        ticketId,
        messageId: null,
        open: changes.isOpen,
      });
    if (changes.isContributive !== undefined)
      await this.contributions.refresh([view.creator]);
    const fresh = (await this.tickets.findById(ticketId, {
      withMessages: true,
    }))!;
    return this.responses.detail(
      principal,
      fresh,
      await this.context.accessView(fresh),
    );
  }

  /** Every name must be an active user; the issue names the field, never which name failed. */
  private async assigneeIds(usernames: string[]): Promise<string[]> {
    const users = await Promise.all(
      unique(usernames).map((username) => this.users.findByUsername(username)),
    );
    if (users.some((user) => !user?.isActive))
      throw invalidField(
        'assignees',
        'Every assignee must be an active user',
        'assignee_unknown',
      );
    return unique(users.map((user) => user!._id));
  }
}
