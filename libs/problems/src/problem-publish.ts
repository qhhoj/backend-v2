import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import type { Problem } from '@libs/database';
import { ProblemAccess } from './problem-access';

/** The sets are constants because the API response names them as OpenAPI enums (`PublishOutcome`, `PublishSkipReason`). */
export const PUBLISH_OUTCOMES = ['published', 'unchanged', 'skipped'] as const;
export type PublishOutcome = (typeof PUBLISH_OUTCOMES)[number];
export const PUBLISH_SKIP_REASONS = [
  'no_permission',
  'organization_private',
  'not_found',
] as const;
export type PublishSkipReason = (typeof PUBLISH_SKIP_REASONS)[number];
export interface PublishVerdict {
  outcome: PublishOutcome;
  reason: PublishSkipReason | null;
}

/** The two rights an edit of `isPublic` needs: edit rights on the problem and `judge.change_public_visibility`. */
export function mayPublish(principal: Principal, problem: Problem): boolean {
  return (
    ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem)) &&
    hasPermission(principal, 'judge.change_public_visibility')
  );
}

/** What publishing this problem would do for this actor: the one decision behind the manual action, its dry run and the automatic job. `published` means "is, or in a dry run would be, made public". */
export function publishVerdict(
  principal: Principal,
  problem: Problem | null,
): PublishVerdict {
  if (!problem) return { outcome: 'skipped', reason: 'not_found' };
  if (problem.isPublic) return { outcome: 'unchanged', reason: null };
  if (problem.isOrganizationPrivate)
    return { outcome: 'skipped', reason: 'organization_private' };
  if (!mayPublish(principal, problem))
    return { outcome: 'skipped', reason: 'no_permission' };
  return { outcome: 'published', reason: null };
}

/** Public and past its publish time: the rule readers apply to an editorial. A lean document may carry `undefined` instead of `null`. */
export const isEditorialReleased = (
  solution: Problem['solution'],
  now: Date,
): boolean =>
  solution != null && solution.isPublic && solution.publishOn <= now;
