import {
  contestAnnouncementDraft,
  fitDraft,
  isSafeNotificationPath,
  NOTIFICATION_RETENTION_DAYS,
  notificationExpiry,
  organizationRequestDraft,
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
  it.each([
    '/tickets/0191-abc',
    '/contests/round_1/announcements',
    '/problems/sum?tab=editorial&x=%20',
    '/',
  ])('accepts %s', (path) => expect(isSafeNotificationPath(path)).toBe(true));

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

  it('leaves a draft that fits as it is', () => {
    expect(fitDraft(draft())).toEqual(draft());
  });

  it('refuses a path that leaves the site', () => {
    expect(() => fitDraft(draft({ path: '//evil.com' }))).toThrow(/path/i);
  });
});

describe('notificationExpiry', () => {
  it('is the last activity plus the retention days', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    expect(notificationExpiry(at).getTime() - at.getTime()).toBe(
      NOTIFICATION_RETENTION_DAYS * 24 * 3_600_000,
    );
  });
});

describe('draft builders', () => {
  it('merges every announcement of a contest into one group, shown as high priority', () => {
    const base = {
      contestId: 'c1',
      contestKey: 'round_1',
      contestName: 'Vòng 1',
    };
    const first = contestAnnouncementDraft({ ...base, announcementTitle: 'A' });
    const second = contestAnnouncementDraft({
      ...base,
      announcementTitle: 'B',
    });
    expect(first.groupKey).toBe(second.groupKey);
    expect(first).toMatchObject({
      kind: 'contest-announcement',
      priority: 'high',
      path: '/contests/round_1/announcements',
      body: 'A',
    });
    expect(isSafeNotificationPath(first.path)).toBe(true);
  });

  it('keeps announcements of different contests apart', () => {
    const one = contestAnnouncementDraft({
      contestId: 'c1',
      contestKey: 'a',
      contestName: 'A',
      announcementTitle: 'x',
    });
    const other = contestAnnouncementDraft({
      contestId: 'c2',
      contestKey: 'b',
      contestName: 'B',
      announcementTitle: 'x',
    });
    expect(one.groupKey).not.toBe(other.groupKey);
  });

  it('says whether the join request was approved or refused, and points to the organization', () => {
    const input = {
      requestId: 'r1',
      slug: 'thpt-chuyen',
      organizationName: 'THPT Chuyên',
    };
    const approved = organizationRequestDraft({ ...input, approved: true });
    const refused = organizationRequestDraft({ ...input, approved: false });
    expect(approved.title).toContain('đã được duyệt');
    expect(refused.title).toContain('đã bị từ chối');
    expect(approved).toMatchObject({
      kind: 'organization-request-decided',
      priority: 'normal',
      path: '/organizations/thpt-chuyen',
      groupKey: 'org-request:r1',
    });
  });
});
