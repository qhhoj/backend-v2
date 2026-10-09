import { unique } from '@libs/common';
import { excerpt } from './discord';
import type { NotificationDraft } from './notifications';

/** Holders of `change_ticket` alerted about a ticket nobody is assigned to. */
export const TICKET_STAFF_NOTIFY_LIMIT = 100;

/** Every event of one ticket merges into the user's one unread row. */
export const ticketGroupKey = (ticketId: string): string =>
  `ticket:${ticketId}`;

/** The SPA page of a ticket. */
const ticketInboxPath = (ticketId: string): string => `/tickets/${ticketId}`;

/** Everybody in the lists once, without the person who acted. */
export const ticketRecipients = (
  actor: string,
  ...lists: ReadonlyArray<readonly string[]>
): string[] => unique(lists.flat()).filter((id) => id !== actor);

export const newTicketDraft = ({
  ticketId,
  title,
  body,
}: {
  ticketId: string;
  title: string;
  body: string;
}): NotificationDraft => ({
  kind: 'ticket-new',
  title: `Phiếu hỗ trợ mới: ${title}`,
  body: excerpt(body, 200),
  path: ticketInboxPath(ticketId),
  priority: 'normal',
  groupKey: ticketGroupKey(ticketId),
});

export const assignedTicketDraft = ({
  ticketId,
  title,
}: {
  ticketId: string;
  title: string;
}): NotificationDraft => ({
  kind: 'ticket-new',
  title: `Bạn được giao một phiếu hỗ trợ: ${title}`,
  body: '',
  path: ticketInboxPath(ticketId),
  priority: 'normal',
  groupKey: ticketGroupKey(ticketId),
});

export const ticketMessageDraft = ({
  ticketId,
  ticketTitle,
  body,
  priority,
}: {
  ticketId: string;
  ticketTitle: string;
  body: string;
  priority: NotificationDraft['priority'];
}): NotificationDraft => ({
  kind: 'ticket-message',
  title: 'Phiếu hỗ trợ có trả lời mới',
  body: excerpt(`${ticketTitle}: ${body}`, 200),
  path: ticketInboxPath(ticketId),
  priority,
  groupKey: ticketGroupKey(ticketId),
});

export const ticketStatusDraft = ({
  ticketId,
  ticketTitle,
  open,
}: {
  ticketId: string;
  ticketTitle: string;
  open: boolean;
}): NotificationDraft => ({
  kind: 'ticket-status',
  title: open ? 'Phiếu hỗ trợ đã được mở lại' : 'Phiếu hỗ trợ đã được đóng',
  body: ticketTitle,
  path: ticketInboxPath(ticketId),
  priority: 'normal',
  groupKey: ticketGroupKey(ticketId),
});
