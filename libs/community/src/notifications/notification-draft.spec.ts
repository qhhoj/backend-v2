import {
  contestAnnouncementDraft,
  fitDraft,
  isSafeNotificationPath,
} from './notification-draft';
import type { NotificationDraft } from './notification-draft';

const draft = (
  overrides: Partial<NotificationDraft> = {},
): NotificationDraft => ({
  kind: 'ticket-message',
  title: 'Phiếu hỗ trợ có trả lời mới',
  body: 'Xin chào',
  path: '/tickets/abc',
  priority: 'normal',
  groupKey: 'ticket:abc',
  ...overrides,
});

describe('isSafeNotificationPath', () => {
  it.each(['/tickets/0191-abc', '/problems/sum?tab=editorial&x=%20'])(
    'accepts %s',
    (path) => expect(isSafeNotificationPath(path)).toBe(true),
  );

  it.each([
    '//evil.com',
    '//evil.com/x',
    '/\\evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    'tickets/1',
    '',
    '/a b',
    `/${'a'.repeat(200)}`,
  ])('refuses %s', (path) => expect(isSafeNotificationPath(path)).toBe(false));
});

describe('fitDraft', () => {
  it('cuts the texts to their column sizes by code points, not UTF-16 units', () => {
    const fitted = fitDraft(
      draft({ title: '😀'.repeat(150), body: 'ế'.repeat(300) }),
    );
    expect([...fitted.title]).toHaveLength(100);
    expect([...fitted.body]).toHaveLength(200);
  });

  it('refuses an unknown kind and a groupKey that is empty or too long', () => {
    expect(() => fitDraft(draft({ kind: 'bogus' as never }))).toThrow(/kind/i);
    expect(() => fitDraft(draft({ groupKey: '' }))).toThrow(/groupKey/);
    expect(() => fitDraft(draft({ groupKey: 'g'.repeat(101) }))).toThrow(
      /groupKey/,
    );
    expect(fitDraft(draft({ groupKey: 'g'.repeat(100) }))).toBeDefined();
  });

  it('refuses a path that leaves the site', () => {
    expect(() => fitDraft(draft({ path: '//evil.com' }))).toThrow(/path/i);
  });
});

describe('contestAnnouncementDraft', () => {
  it('escapes characters encodeURIComponent leaves bare, so the path stays safe', () => {
    const built = contestAnnouncementDraft({
      contestId: 'c1',
      contestKey: "it's(1)*~!",
      contestName: 'X',
      announcementTitle: 'A',
    });
    expect(isSafeNotificationPath(built.path)).toBe(true);
    expect(() => fitDraft(built)).not.toThrow();
  });
});
