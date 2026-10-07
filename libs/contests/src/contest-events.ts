import { isUuid } from '@libs/database';

/** Redis pub/sub, best effort: the api publishes, every api process fans out to contest streams. Ids only; the page reads the content. */
export const CONTEST_EVENTS_CHANNEL = 'contest-events';
export interface ContestEvent {
  type: 'announcement';
  contestId: string;
  announcementId: string;
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && isUuid(value);

export function parseContestEvent(raw: string): ContestEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { type, contestId, announcementId } = value as Record<string, unknown>;
  return type === 'announcement' && isId(contestId) && isId(announcementId)
    ? { type, contestId, announcementId }
    : null;
}
