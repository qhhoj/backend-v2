import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, unique } from '@libs/common';
import { timelineEventsOf } from '@libs/community';
import { uuidStr } from '@libs/database';
import { ContributionPointsService } from '../../contributions/contribution-points.service';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import { TicketNotificationsService } from '../alerts/ticket-notifications.service';
import type { TicketDetailResponse } from '../core/dto/ticket.response';
import { TicketAccess } from '../core/ticket-access';
import type { TicketAccessView } from '../core/ticket-access';
import { TicketContextService } from '../core/ticket-context.service';
import { TicketResponsesService } from '../core/ticket-responses.service';
import { TicketsRepository } from '../core/tickets.repository';
import type { TicketChanges, TicketDocument } from '../core/tickets.repository';
import { TicketEventsService } from '../streams/ticket-events.service';
import type { UpdateTicketDto } from './dto/update-ticket.dto';

const forbidden = (message: string) => new AppError('forbidden', 403, message);

/** What `afterUpdate` needs once the change is stored. */
interface UpdateAftermath {
  principal: Principal;
  ticket: TicketDocument;
  view: TicketAccessView;
  changes: TicketChanges;
}

/**
 * Legacy `TicketStatusChangeView` and `TicketNotesEditView` as one PATCH.
 * Every permission and every username is checked before the single `updateOne`, so a refused request writes nothing.
 * The state change and its timeline entries go out in that one write.
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
    private readonly alerts: TicketNotificationsService,
    private readonly problems: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
  ) {}

  async update(
    principal: Principal,
    ticketId: string,
    dto: UpdateTicketDto,
  ): Promise<TicketDetailResponse> {
    const { ticket, view } = await this.context.accessible(principal, ticketId);
    this.assertAllowed(principal, view, dto);
    const changes = await this.changesOf(ticket, dto);
    const before = {
      isOpen: ticket.isOpen,
      isContributive: ticket.isContributive,
      assignees: view.assignees,
      title: ticket.title,
      linkedItem: ticket.linkedItem,
    };
    const timeline = timelineEventsOf({
      actor: principal.userId,
      at: new Date(),
      before,
      changes,
    });
    if (!(await this.tickets.update(ticketId, changes, before, timeline)))
      throw new AppError(
        'conflict',
        409,
        'The ticket changed while you were editing it; reload and try again',
      );
    await this.recordMove(principal, ticket, changes);
    await this.afterUpdate({ principal, ticket, view, changes });
    const fresh = (await this.tickets.findById(ticketId, {
      withMessages: true,
    }))!;
    return this.responses.detail(
      principal,
      fresh,
      await this.context.accessView(fresh),
    );
  }

  private assertAllowed(
    principal: Principal,
    view: TicketAccessView,
    dto: UpdateTicketDto,
  ): void {
    if (
      dto.isContributive !== undefined &&
      !TicketAccess.canMarkGood(principal, view)
    )
      throw forbidden('Only staff can mark tickets good, and never their own');
    if (dto.notes !== undefined && !TicketAccess.canEditNotes(principal, view))
      throw forbidden('Only assignees and staff can edit notes');
    if (dto.assignees !== undefined && !TicketAccess.canAssign(principal))
      throw forbidden('Only staff can change assignees');
    if (
      (dto.title !== undefined || dto.problem !== undefined) &&
      !TicketAccess.canAssign(principal)
    )
      throw forbidden('Only staff can retitle or relink a ticket');
  }

  /** Only what really differs from the stored ticket. */
  private async changesOf(
    ticket: TicketDocument,
    dto: UpdateTicketDto,
  ): Promise<TicketChanges> {
    const changes: TicketChanges = {};
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
    if (dto.title !== undefined && dto.title !== ticket.title)
      changes.title = dto.title;
    if (dto.problem !== undefined) {
      const linkedItem = await this.problemLink(dto.problem);
      if (
        ticket.linkedItem.type !== 'problem' ||
        uuidStr(ticket.linkedItem.id) !== linkedItem.id
      )
        changes.linkedItem = linkedItem;
    }
    return changes;
  }

  /** A live (not deleted) problem by code; 400 `problem_unknown` otherwise. */
  private async problemLink(
    code: string,
  ): Promise<{ type: 'problem'; id: string }> {
    const problem = await this.problems.findForAccessByCode(code);
    if (!problem)
      throw invalidField('problem', 'No such problem', 'problem_unknown');
    return { type: 'problem', id: uuidStr(problem._id) };
  }

  /** A retitle or relink has no timeline entry: a `ticket` revision keeps who did it and the old title or link (a general ticket's issue row stays, so its url is not lost). */
  private async recordMove(
    principal: Principal,
    ticket: TicketDocument,
    changes: TicketChanges,
  ): Promise<void> {
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    if (changes.title !== undefined)
      diff.title = { before: ticket.title, after: changes.title };
    if (changes.linkedItem !== undefined)
      diff.linkedItem = {
        before: {
          type: ticket.linkedItem.type,
          id: uuidStr(ticket.linkedItem.id),
        },
        after: changes.linkedItem,
      };
    if (Object.keys(diff).length)
      await this.revisions.append({
        entity: 'ticket',
        entityId: uuidStr(ticket._id),
        action: 'edit',
        userId: principal.userId,
        changes: diff,
        comment: 'Edited from site',
      });
  }

  /** Everything told about the change once it is stored: the SSE feed, the creator's contribution points and the inboxes. */
  private async afterUpdate({
    principal,
    ticket,
    view,
    changes,
  }: UpdateAftermath): Promise<void> {
    const ticketId = uuidStr(ticket._id);
    if (changes.isOpen !== undefined)
      await this.events.publish({
        type: 'ticket-status',
        ticketId,
        messageId: null,
        open: changes.isOpen,
      });
    if (changes.isContributive !== undefined)
      await this.contributions.refresh([view.creator]);
    await this.alerts.updated({
      actor: principal.userId,
      ticketId,
      ticketTitle: changes.title ?? ticket.title,
      owner: view.creator,
      assigneesBefore: view.assignees,
      changes,
    });
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
