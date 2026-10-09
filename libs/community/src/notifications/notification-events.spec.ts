import { newId } from '@libs/database';
import { parseNotificationEvent } from './notification-events';

describe('parseNotificationEvent', () => {
  it('rebuilds the event field by field, forwarding nothing else', () => {
    const userId = newId();
    const id = newId();
    expect(
      parseNotificationEvent(JSON.stringify({ userId, id, secret: 'x' })),
    ).toEqual({ userId, id });
  });

  it.each([
    'not json',
    'null',
    '[]',
    JSON.stringify({ userId: 'u', id: 'i' }),
    JSON.stringify({ userId: newId() }),
    JSON.stringify({ userId: newId(), id: 5 }),
    JSON.stringify({ userId: newId(), id: 'not-a-uuid' }),
  ])('ignores %s', (raw) => expect(parseNotificationEvent(raw)).toBeNull());
});
