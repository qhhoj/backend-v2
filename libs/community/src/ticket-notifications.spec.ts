import { isSafeNotificationPath } from './notifications';
import {
  assignedTicketDraft,
  newTicketDraft,
  ticketGroupKey,
  ticketMessageDraft,
  ticketRecipients,
  ticketStatusDraft,
} from './ticket-notifications';

describe('ticketRecipients', () => {
  it('lists every id once and never the actor', () => {
    expect(ticketRecipients('actor', ['a', 'actor'], ['b', 'a'], [])).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('ticket drafts', () => {
  const drafts = [
    newTicketDraft({ ticketId: 't1', title: 'Lỗi', body: 'Chi tiết' }),
    assignedTicketDraft({ ticketId: 't1', title: 'Lỗi' }),
    ticketMessageDraft({
      ticketId: 't1',
      ticketTitle: 'Lỗi',
      body: 'Đã sửa',
      priority: 'high',
    }),
    ticketStatusDraft({ ticketId: 't1', ticketTitle: 'Lỗi', open: false }),
  ];

  it('merge into one group per ticket and point at the ticket page', () => {
    for (const draft of drafts) {
      expect(draft.groupKey).toBe(ticketGroupKey('t1'));
      expect(draft.path).toBe('/tickets/t1');
      expect(isSafeNotificationPath(draft.path)).toBe(true);
    }
  });

  it('tells closing from reopening', () => {
    expect(drafts[3].title).toContain('đóng');
    expect(
      ticketStatusDraft({ ticketId: 't1', ticketTitle: 'Lỗi', open: true })
        .title,
    ).toContain('mở lại');
  });
});
