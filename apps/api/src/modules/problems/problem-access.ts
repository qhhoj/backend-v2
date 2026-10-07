import { hasPermission, type Permission, type Principal } from '@libs/auth';
import { Problem, uuidStr } from '@libs/database';
import type { FilterQuery } from 'mongoose';

export interface ProblemAccessView {
  id: string;
  isPublic: boolean;
  isOrganizationPrivate: boolean;
  organizations: string[];
  authors: string[];
  curators: string[];
  testers: string[];
  suggester: string | null;
}

/** Plain-string view of a problem document (UUID arrays on hydrated documents are buffers under `.map`). */
function accessView(problem: Problem): ProblemAccessView {
  return {
    id: uuidStr(problem._id),
    isPublic: problem.isPublic,
    isOrganizationPrivate: problem.isOrganizationPrivate,
    organizations: (problem.organizations ?? []).map(uuidStr),
    authors: (problem.authors ?? []).map(uuidStr),
    curators: (problem.curators ?? []).map(uuidStr),
    testers: (problem.testers ?? []).map(uuidStr),
    suggester: problem.suggester == null ? null : uuidStr(problem.suggester),
  };
}

/** A suggested problem that has not been published. */
const isSuggesting = (problem: ProblemAccessView) =>
  problem.suggester !== null && !problem.isPublic;
/** Legacy `editor_ids`: authors, curators and the suggester. */
const isEditor = (principal: Principal, problem: ProblemAccessView) =>
  problem.authors.includes(principal.userId) ||
  problem.curators.includes(principal.userId) ||
  problem.suggester === principal.userId;

function canEdit(
  principal: Principal | null,
  problem: ProblemAccessView,
): boolean {
  if (!principal || !hasPermission(principal, 'judge.edit_own_problem'))
    return false;
  if (
    hasPermission(principal, 'judge.suggest_new_problem') &&
    isSuggesting(problem)
  )
    return true;
  if (
    hasPermission(principal, 'judge.edit_all_problem') ||
    (hasPermission(principal, 'judge.edit_public_problem') && problem.isPublic)
  )
    return true;
  return isEditor(principal, problem);
}

/** The viewer's current contest (`CurrentContestService.scopeOf`): before it starts every problem is hidden; once started its problems are visible whatever their publicity (legacy `is_accessible_by` step 1). */
export interface ContestScope {
  started: boolean;
  problemIds: readonly string[];
}

function canSee(
  principal: Principal | null,
  problem: ProblemAccessView,
  scope: ContestScope | null,
): boolean {
  if (scope) {
    if (!scope.started) return false;
    if (scope.problemIds.includes(problem.id)) return true;
  }
  const has = (permission: Permission) =>
    principal !== null && hasPermission(principal, permission);
  // A public problem is never "suggesting", so the spec's "public & not suggesting" is just `isPublic`.
  if (problem.isPublic) {
    if (!problem.isOrganizationPrivate || has('judge.see_organization_problem'))
      return true;
    if (
      principal &&
      problem.organizations.some((organizationId) =>
        principal.organizationIds.includes(organizationId),
      )
    )
      return true;
  }
  if (!principal) return false;
  if (
    has('judge.see_private_problem') ||
    canEdit(principal, problem) ||
    isEditor(principal, problem)
  )
    return true;
  if (has('judge.suggest_new_problem') && isSuggesting(problem)) return true;
  return problem.testers.includes(principal.userId);
}

function ownVisibleFilter(principal: Principal | null): FilterQuery<Problem> {
  if (!principal) return { isPublic: true, isOrganizationPrivate: false };
  const has = (permission: Permission) => hasPermission(principal, permission);
  const editOwn = has('judge.edit_own_problem');
  if (
    has('judge.see_private_problem') ||
    (editOwn && has('judge.edit_all_problem'))
  )
    return {};
  const seesAllPublic =
    has('judge.see_organization_problem') ||
    (editOwn && has('judge.edit_public_problem'));
  const { userId } = principal;
  const clauses: FilterQuery<Problem>[] = [
    seesAllPublic
      ? { isPublic: true }
      : {
          isPublic: true,
          $or: [
            { isOrganizationPrivate: false },
            { organizations: { $in: principal.organizationIds } },
          ],
        },
    { authors: userId },
    { curators: userId },
    { testers: userId },
    { suggester: userId },
  ];
  if (has('judge.suggest_new_problem'))
    clauses.push({ isPublic: false, suggester: { $ne: null } });
  return { $or: clauses };
}

/** Mongo filter with exactly `canSee`'s semantics, for lists. */
function visibleFilter(
  principal: Principal | null,
  scope: ContestScope | null,
): FilterQuery<Problem> {
  const own = ownVisibleFilter(principal);
  if (!scope) return own;
  if (!scope.started) return { _id: { $in: [] } };
  return Object.keys(own).length
    ? { $or: [{ _id: { $in: [...scope.problemIds] } }, own] }
    : own;
}

export const ProblemAccess = { accessView, canSee, canEdit, visibleFilter };
