import { newId } from '@libs/database';
import { parseTicketEvent } from './ticket-events';

describe('parseTicketEvent', () => {
  const ticketId = newId();
  const event = (extra: object) =>
    JSON.stringify({
      type: 'ticket-status',
      ticketId,
      messageId: null,
      open: false,
      ...extra,
    });

  it('rebuilds a valid event field by field and drops extras', () => {
    expect(parseTicketEvent(event({ secret: 'x' }))).toEqual({
      type: 'ticket-status',
      ticketId,
      messageId: null,
      open: false,
    });
  });

  it.each([
    ['not json', '{'],
    ['an unknown type', event({ type: 'x' })],
    ['a malformed ticket id', event({ ticketId: '1' })],
    ['a malformed message id', event({ messageId: 'nope' })],
    ['a non-boolean open', event({ open: 'yes' })],
  ])('ignores %s', (_name, raw) => {
    expect(parseTicketEvent(raw)).toBeNull();
  });
});
