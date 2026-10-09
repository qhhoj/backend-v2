import type { TicketTimelineType } from '@libs/database';

/** Entries kept per ticket; every write slices to this (the oldest fall off, a change is never refused). */
export const TICKET_TIMELINE_CAP = 200;

/** What the repository stores per state change (it adds the id). */
export interface TicketTimelineDraft {
  type: TicketTimelineType;
  /** Who did it. */
  user: string;
  at: Date;
  /** The assignee of `assigned` / `unassigned`, else null. */
  target: string | null;
}

/** The stored state an update was decided on: the timeline is derived from it and the repository's compare-and-set guards on it. */
export interface TicketStateSnapshot {
  isOpen: boolean;
  isContributive: boolean;
  assignees: readonly string[];
}
export interface TicketChangeSet {
  isOpen?: boolean;
  isContributive?: boolean;
  assignees?: readonly string[];
}

interface TimelineInput {
  actor: string;
  at: Date;
  before: TicketStateSnapshot;
  changes: TicketChangeSet;
}

const entryOf =
  ({ actor, at }: Pick<TimelineInput, 'actor' | 'at'>) =>
  (
    type: TicketTimelineType,
    target: string | null = null,
  ): TicketTimelineDraft => ({
    type,
    user: actor,
    at,
    target,
  });

function stateEvents(
  { before, changes }: Pick<TimelineInput, 'before' | 'changes'>,
  entry: ReturnType<typeof entryOf>,
): TicketTimelineDraft[] {
  const drafts: TicketTimelineDraft[] = [];
  if (changes.isOpen !== undefined && changes.isOpen !== before.isOpen)
    drafts.push(entry(changes.isOpen ? 'reopened' : 'closed'));
  if (
    changes.isContributive !== undefined &&
    changes.isContributive !== before.isContributive
  )
    drafts.push(
      entry(changes.isContributive ? 'marked-good' : 'unmarked-good'),
    );
  return drafts;
}

function assigneeEvents(
  { before, changes }: Pick<TimelineInput, 'before' | 'changes'>,
  entry: ReturnType<typeof entryOf>,
): TicketTimelineDraft[] {
  if (changes.assignees === undefined) return [];
  const now = new Set(changes.assignees);
  const was = new Set(before.assignees);
  return [
    ...before.assignees
      .filter((id) => !now.has(id))
      .map((id) => entry('unassigned', id)),
    ...changes.assignees
      .filter((id) => !was.has(id))
      .map((id) => entry('assigned', id)),
  ];
}

/** The timeline entries one edit adds: status, then good, then who left, then who joined; only real changes. */
export function timelineEventsOf(input: TimelineInput): TicketTimelineDraft[] {
  const entry = entryOf(input);
  return [...stateEvents(input, entry), ...assigneeEvents(input, entry)];
}

export type TimelineEntry<Message, Event> =
  | { kind: 'message'; at: Date; message: Message }
  | { kind: 'event'; at: Date; event: Event };

/** Messages and events by time. Messages are listed first and `sort` is stable, so at the same instant a message precedes an event (the reply that closes a ticket reads before "closed") and entries of one kind keep their stored order. */
export function mergeTimeline<
  Message extends { createdAt: Date },
  Event extends { at: Date },
>(
  messages: readonly Message[],
  events: readonly Event[],
): Array<TimelineEntry<Message, Event>> {
  const entries: Array<TimelineEntry<Message, Event>> = [
    ...messages.map((message): TimelineEntry<Message, Event> => ({
      kind: 'message',
      at: message.createdAt,
      message,
    })),
    ...events.map((event): TimelineEntry<Message, Event> => ({
      kind: 'event',
      at: event.at,
      event,
    })),
  ];
  return entries.sort((left, right) => left.at.getTime() - right.at.getTime());
}
