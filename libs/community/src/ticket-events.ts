import { isUuid } from '@libs/database';

/** Redis pub/sub, best effort: the api publishes, every api process fans out to ticket streams. Ids only; the page reads the content. */
export const TICKET_EVENTS_CHANNEL = 'ticket-events';
export const TICKET_EVENT_TYPES = [
  'new-ticket',
  'ticket-message',
  'ticket-status',
] as const;
export type TicketEventType = (typeof TICKET_EVENT_TYPES)[number];

export interface TicketEvent {
  type: TicketEventType;
  ticketId: string;
  /** The new message on `ticket-message`, else null. */
  messageId: string | null;
  /** The new state on `ticket-status`, else null. */
  open: boolean | null;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && isUuid(value);

/** Rebuilt field by field, so nothing beyond the contract is forwarded; null = ignore. */
export function parseTicketEvent(raw: string): TicketEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { type, ticketId, messageId, open } = value as Record<string, unknown>;
  const typeKnown = TICKET_EVENT_TYPES.includes(type as TicketEventType);
  if (
    !typeKnown ||
    !isId(ticketId) ||
    !(messageId === null || isId(messageId)) ||
    !(open === null || typeof open === 'boolean')
  )
    return null;
  return { type: type as TicketEventType, ticketId, messageId, open };
}
