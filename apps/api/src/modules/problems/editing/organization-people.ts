import type { Principal } from '@libs/auth';
import type { CreationTarget } from '../../organizations/creation/organization-creation-rights.service';
import type { CreateProblemDto } from './dto/problem-edit.dto';

/** The staff people fields an organization create may fill without `judge.edit_all_problem`. */
const PEOPLE_FIELDS = ['authors', 'curators'] as const;
type PeopleField = (typeof PEOPLE_FIELDS)[number];

/**
 * The staff gates an organization create (`POST /organizations/:slug/problems`, an import with `organization`) opens:
 * `authors` or `curators` naming only the organization's administrators, or the requester (a
 * `judge.edit_all_organization` holder creates there without being one). Anyone else still needs
 * `judge.edit_all_problem`, as authors and curators gain edit rights on the problem.
 */
export function organizationPeopleWaiver(
  principal: Principal,
  target: Pick<CreationTarget, 'adminIds'>,
  people: Partial<Record<PeopleField, string[]>>,
): ReadonlyArray<keyof CreateProblemDto> {
  const allowed = new Set([...target.adminIds, principal.userId]);
  return PEOPLE_FIELDS.filter((field) =>
    (people[field] ?? []).every((id) => allowed.has(id)),
  );
}
