import { newId } from '@libs/database';
import { parseContestEvent } from './contest-events';

describe('parseContestEvent', () => {
  const event = {
    type: 'announcement',
    contestId: newId(),
    announcementId: newId(),
  };

  it('round-trips an event and drops extra fields', () => {
    expect(
      parseContestEvent(
        JSON.stringify({ ...event, title: 'leak', description: 'leak' }),
      ),
    ).toEqual(event);
  });

  it.each([
    ['not JSON', '{'],
    ['an unknown type', JSON.stringify({ ...event, type: 'clarification' })],
    ['a bad contest id', JSON.stringify({ ...event, contestId: 'x' })],
    [
      'a missing announcement id',
      JSON.stringify({ type: 'announcement', contestId: event.contestId }),
    ],
    ['null', 'null'],
  ])('ignores %s', (_case, raw) => expect(parseContestEvent(raw)).toBeNull());
});
