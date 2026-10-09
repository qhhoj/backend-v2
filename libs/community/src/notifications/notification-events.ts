import { isUuid } from '@libs/database';

/** Redis pub/sub, best effort: the writer of a row publishes, every api process nudges the owner's open `user` streams. Ids only; the page reads the content. */
export const NOTIFICATION_EVENTS_CHANNEL = 'notification-events';

export interface NotificationEvent {
  /** The owner of the row. */
  userId: string;
  /** The row that was created or merged into. */
  id: string;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && isUuid(value);

/** Rebuilt field by field, so nothing beyond the contract is forwarded; null = ignore. */
export function parseNotificationEvent(raw: string): NotificationEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { userId, id } = value as Record<string, unknown>;
  return isId(userId) && isId(id) ? { userId, id } : null;
}
