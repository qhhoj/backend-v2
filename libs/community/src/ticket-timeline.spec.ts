import { mergeTimeline, timelineEventsOf } from './ticket-timeline';
import type { TicketStateSnapshot, TimelineEntry } from './ticket-timeline';

const at = new Date('2026-10-09T10:00:00Z');
const before: TicketStateSnapshot = {
  isOpen: true,
  isContributive: false,
  assignees: ['a', 'b'],
};
const events = (changes: Parameters<typeof timelineEventsOf>[0]['changes']) =>
  timelineEventsOf({ actor: 'staff', at, before, changes }).map((event) => [
    event.type,
    event.target,
  ]);

describe('timelineEventsOf', () => {
  it('records closing and reopening only when the state really changes', () => {
    expect(events({ isOpen: false })).toEqual([['closed', null]]);
    expect(events({ isOpen: true })).toEqual([]);
    const closed = { ...before, isOpen: false };
    expect(
      timelineEventsOf({
        actor: 'u',
        at,
        before: closed,
        changes: { isOpen: true },
      }).map((event) => event.type),
    ).toEqual(['reopened']);
  });

  it('records who was unassigned, then who was assigned, by the difference', () => {
    expect(events({ assignees: ['b', 'c', 'd'] })).toEqual([
      ['unassigned', 'a'],
      ['assigned', 'c'],
      ['assigned', 'd'],
    ]);
    expect(events({ assignees: ['a', 'b'] })).toEqual([]);
  });

  it('puts every change of one edit in a fixed order, all stamped with the actor and time', () => {
    const drafts = timelineEventsOf({
      actor: 'staff',
      at,
      before,
      changes: { isOpen: false, isContributive: true, assignees: ['c'] },
    });
    expect(drafts.map((draft) => draft.type)).toEqual([
      'closed',
      'marked-good',
      'unassigned',
      'unassigned',
      'assigned',
    ]);
    expect(
      drafts.every((draft) => draft.user === 'staff' && draft.at === at),
    ).toBe(true);
  });
});

describe('mergeTimeline', () => {
  const message = (id: string, minute: number) => ({
    id,
    createdAt: new Date(Date.UTC(2026, 9, 9, 10, minute)),
  });
  const event = (id: string, minute: number) => ({
    id,
    at: new Date(Date.UTC(2026, 9, 9, 10, minute)),
  });
  const ids = (
    entries: Array<
      TimelineEntry<{ id: string; createdAt: Date }, { id: string; at: Date }>
    >,
  ) =>
    entries.map((entry) =>
      entry.kind === 'message' ? entry.message.id : entry.event.id,
    );

  it('puts a message before an event at the same instant, and keeps stored order inside a kind', () => {
    expect(
      ids(
        mergeTimeline(
          [message('m1', 3), message('m2', 3)],
          [event('e1', 3), event('e2', 3)],
        ),
      ),
    ).toEqual(['m1', 'm2', 'e1', 'e2']);
  });
});
