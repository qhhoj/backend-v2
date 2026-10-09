import { Injectable, Logger } from '@nestjs/common';
import {
  assignedTicketDraft,
  newTicketDraft,
  NotificationsService,
  ticketGroupKey,
  ticketMessageDraft,
  ticketRecipients,
  ticketStatusDraft,
  TICKET_STAFF_NOTIFY_LIMIT,
} from '@libs/community';
import type { TicketChanges } from '../core/tickets.repository';
import { TicketStaffRepository } from './ticket-staff.repository';

export interface FiledTicket {
  ticketId: string;
  title: string;
  body: string;
  creator: string;
  assignees: string[];
}

export interface PostedMessage {
  ticketId: string;
  ticketTitle: string;
  body: string;
  author: string;
  authorIsStaff: boolean;
  owner: string;
  assignees: string[];
}

export interface UpdatedTicket {
  actor: string;
  ticketId: string;
  ticketTitle: string;
  owner: string;
  assigneesBefore: string[];
  changes: TicketChanges;
}

/** The ticket write paths call this after their own write committed: every outcome is a notification or a log line, never an error. */
@Injectable()
export class TicketNotificationsService {
  private readonly logger = new Logger(TicketNotificationsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly staff: TicketStaffRepository,
  ) {}

  /** The assignees; a general ticket has none, so the staff. Never the filer. */
  async filed(input: FiledTicket): Promise<void> {
    const watchers = input.assignees.length
      ? input.assignees
      : await this.staffHolders();
    await this.notifications.notify(
      ticketRecipients(input.creator, watchers),
      newTicketDraft(input),
    );
  }

  /** The owner (high priority when staff wrote), and the assignees; with nobody assigned and the owner writing, the staff. Never the author. */
  async messagePosted(input: PostedMessage): Promise<void> {
    const { author, owner, assignees } = input;
    const text = {
      ticketId: input.ticketId,
      ticketTitle: input.ticketTitle,
      body: input.body,
    };
    await this.notifications.notify(
      ticketRecipients(author, [owner]),
      ticketMessageDraft({
        ...text,
        priority: input.authorIsStaff ? 'high' : 'normal',
      }),
    );
    const watchers =
      assignees.length || author !== owner
        ? assignees
        : await this.staffHolders();
    await this.notifications.notify(
      ticketRecipients(
        author,
        watchers.filter((id) => id !== owner),
      ),
      ticketMessageDraft({ ...text, priority: 'normal' }),
    );
  }

  async updated(input: UpdatedTicket): Promise<void> {
    const { changes, assigneesBefore } = input;
    if (changes.isOpen !== undefined)
      await this.statusChanged(input, changes.assignees ?? assigneesBefore);
    if (changes.assignees !== undefined)
      await this.assigneesChanged(input, changes.assignees);
  }

  private statusChanged(
    input: UpdatedTicket,
    assigneesNow: string[],
  ): Promise<void> {
    return this.notifications.notify(
      ticketRecipients(input.actor, [input.owner], assigneesNow),
      ticketStatusDraft({
        ticketId: input.ticketId,
        ticketTitle: input.ticketTitle,
        open: input.changes.isOpen!,
      }),
    );
  }

  /** Who joined is alerted, who left no longer has the ticket's unread rows (the owner keeps theirs: they still own the ticket). */
  private async assigneesChanged(
    input: UpdatedTicket,
    assigneesNow: string[],
  ): Promise<void> {
    const added = assigneesNow.filter(
      (id) => !input.assigneesBefore.includes(id),
    );
    const removed = input.assigneesBefore.filter(
      (id) => !assigneesNow.includes(id) && id !== input.owner,
    );
    await this.notifications.notify(
      ticketRecipients(input.actor, added),
      assignedTicketDraft({
        ticketId: input.ticketId,
        title: input.ticketTitle,
      }),
    );
    await this.notifications.dismiss(removed, ticketGroupKey(input.ticketId));
  }

  private async staffHolders(): Promise<string[]> {
    try {
      return await this.staff.holders(TICKET_STAFF_NOTIFY_LIMIT);
    } catch (error) {
      this.logger.error(
        `Looking up ticket staff failed: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
