import { newId } from '@libs/database';
import { parseTicketEvent } from './ticket-events';

describe('parseTicketEvent', () => {
  const ticketId = newId();
  it('rebuilds a valid event field by field and drops extras', () => {
    const raw = JSON.stringify({
      type: 'ticket-status',
      ticketId,
      messageId: null,
      open: false,
      secret: 'x',
    });
    expect(parseTicketEvent(raw)).toEqual({
      type: 'ticket-status',
      ticketId,
      messageId: null,
      open: false,
    });
  });

  it.each([
    ['not json', '{'],
    ['an array', '[]'],
    [
      'an unknown type',
      JSON.stringify({ type: 'x', ticketId, messageId: null, open: null }),
    ],
    [
      'a malformed ticket id',
      JSON.stringify({
        type: 'new-ticket',
        ticketId: '1',
        messageId: null,
        open: null,
      }),
    ],
    [
      'a malformed message id',
      JSON.stringify({
        type: 'ticket-message',
        ticketId,
        messageId: 'nope',
        open: null,
      }),
    ],
    [
      'a non-boolean open',
      JSON.stringify({
        type: 'ticket-status',
        ticketId,
        messageId: null,
        open: 'yes',
      }),
    ],
  ])('ignores %s', (_name, raw) => {
    expect(parseTicketEvent(raw)).toBeNull();
  });
});
