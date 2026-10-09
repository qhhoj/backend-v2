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

  it('is empty when only the actor is involved', () => {
    expect(ticketRecipients('actor', ['actor'])).toEqual([]);
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

  it('carry the kind that matches the event', () => {
    expect(drafts.map((draft) => draft.kind)).toEqual([
      'ticket-new',
      'ticket-new',
      'ticket-message',
      'ticket-status',
    ]);
  });

  it('name the ticket and the reply, and the direction of a status change', () => {
    expect(drafts[2].title).toBe('Phiếu hỗ trợ có trả lời mới');
    expect(drafts[2].body).toContain('Lỗi');
    expect(drafts[2].body).toContain('Đã sửa');
    expect(drafts[2].priority).toBe('high');
    expect(drafts[3].title).toContain('đóng');
    expect(
      ticketStatusDraft({ ticketId: 't1', ticketTitle: 'Lỗi', open: true })
        .title,
    ).toContain('mở lại');
  });
});
