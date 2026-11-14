import { AppError } from '@libs/common';

/**
 * Why a share is withheld from everyone but its owner and staff: a staff takedown, an author who was banned,
 * deactivated or deleted, a contest that still keeps the problem's submissions closed, or a setter who keeps sources
 * to owner and testers. The owner and staff read the share with the reason as a notice.
 */
export const SHARE_HIDDEN_REASONS = [
  'taken_down',
  'author_unavailable',
  'contest_running',
  'source_hidden',
] as const;
export type ShareHiddenReason = (typeof SHARE_HIDDEN_REASONS)[number];

/** The rules that refuse sharing a submission, and showing its copy later. */
export type CopyRefusal = Extract<
  ShareHiddenReason,
  'contest_running' | 'source_hidden'
>;

/** Unknown, expired, taken down or by a removed author: one answer, never cached (the code may be made next). */
export const shareNotFound = () =>
  new AppError('not_found', 404, 'No such share', undefined, {
    'Cache-Control': 'no-store',
  });

/** The existing submission-source codes, so the SPA reads them as it does on the submission page. */
export const copyRefusalError = (refusal: CopyRefusal): AppError =>
  refusal === 'contest_running'
    ? new AppError(
        'contest_running',
        403,
        'A contest that uses this problem is running, not started, or has a frozen or hidden board',
      )
    : new AppError(
        'hidden',
        403,
        "The problem's setter keeps submission sources to their owners and testers",
      );
