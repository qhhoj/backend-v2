import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_PATH_MAX,
  NOTIFICATION_PATH_PATTERN,
  NOTIFICATION_TITLE_MAX,
} from '@libs/database';
import type { NotificationKind, NotificationPriority } from '@libs/database';
import { excerpt } from '../discord';

/** An inbox row lives this long after its last activity. */
export const NOTIFICATION_RETENTION_DAYS = 90;
/** Rows kept per user; the nightly trim removes the oldest beyond it. */
export const NOTIFICATION_CAP_PER_USER = 500;
export const NOTIFICATIONS_PAGE_SIZE = 20;
/** Recipients one `notify` call writes; a longer list is cut and logged. */
export const NOTIFY_RECIPIENT_LIMIT = 200;
const DAY_MS = 86_400_000;

/** What a producer says; `NotificationsService.notify` stores it per recipient. */
export interface NotificationDraft {
  kind: NotificationKind;
  /** At most 100 code points; longer text is cut. */
  title: string;
  /** Plain text, at most 200 code points; longer text is cut. */
  body: string;
  /** Internal SPA path, see `isSafeNotificationPath`. */
  path: string;
  priority: NotificationPriority;
  /** Events with the same key merge into the user's one unread row. */
  groupKey: string;
}

export const isSafeNotificationPath = (path: string): boolean =>
  path.length <= NOTIFICATION_PATH_MAX && NOTIFICATION_PATH_PATTERN.test(path);

export const notificationExpiry = (lastActivityAt: Date): Date =>
  new Date(lastActivityAt.getTime() + NOTIFICATION_RETENTION_DAYS * DAY_MS);

/** Cuts the texts to their column sizes (bulk writes skip schema validation). An unsafe path is a programming error: it throws. */
export function fitDraft(draft: NotificationDraft): NotificationDraft {
  if (!isSafeNotificationPath(draft.path))
    throw new Error(`Unsafe notification path: ${draft.path}`);
  return {
    ...draft,
    title: excerpt(draft.title, NOTIFICATION_TITLE_MAX),
    body: excerpt(draft.body, NOTIFICATION_BODY_MAX),
  };
}

export interface AnnouncementDraftInput {
  contestId: string;
  contestKey: string;
  contestName: string;
  announcementTitle: string;
}

/** One row per user per contest: every announcement of the contest merges into it. */
export const contestAnnouncementDraft = ({
  contestId,
  contestKey,
  contestName,
  announcementTitle,
}: AnnouncementDraftInput): NotificationDraft => ({
  kind: 'contest-announcement',
  title: `Thông báo mới trong "${contestName}"`,
  body: announcementTitle,
  path: `/contests/${encodeURIComponent(contestKey)}/announcements`,
  priority: 'high',
  groupKey: `contest-ann:${contestId}`,
});

export interface OrganizationRequestDraftInput {
  requestId: string;
  slug: string;
  organizationName: string;
  approved: boolean;
}

export const organizationRequestDraft = ({
  requestId,
  slug,
  organizationName,
  approved,
}: OrganizationRequestDraftInput): NotificationDraft => ({
  kind: 'organization-request-decided',
  title: approved
    ? `Yêu cầu tham gia "${organizationName}" đã được duyệt`
    : `Yêu cầu tham gia "${organizationName}" đã bị từ chối`,
  body: '',
  path: `/organizations/${encodeURIComponent(slug)}`,
  priority: 'normal',
  groupKey: `org-request:${requestId}`,
});
