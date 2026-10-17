import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { sameJson } from '@libs/common';
import { organizationCodePrefix } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import type { CreateProblemDto } from './dto/problem-edit.dto';
import { assertOrganizationCodePrefix } from './organization-code-prefix';
import {
  leavesForSite,
  ORGANIZATION_RIGHTS_ISSUE,
  organizationRightsRefusal,
  organizationsToAuthorize,
  SITE_PROBLEM_RIGHTS_ISSUE,
} from '../../organizations/creation/organization-move';
import type { OrganizationScope } from '../../organizations/creation/organization-move';
import { MEMBERS_ONLY_VISIBILITY } from './problem-edit-policy.service';
import type { ProblemDocument } from '../core/problems.repository';

/** The staff gates an authorized organization move skips (`STAFF_FIELDS` of the edit policy). */
const ORGANIZATION_FIELDS: ReadonlyArray<keyof CreateProblemDto> = [
  'organizations',
  'isOrganizationPrivate',
];

/** The organization rules of a problem edit: moving between organizations, the code prefix, members-only publishing and file uploads by organization creators. */
@Injectable()
export class OrganizationProblemRules {
  constructor(private readonly rights: OrganizationCreationRights) {}

  /** Authorizes an organization move, checks the prefix of a new code, and returns the gates the editor may skip. */
  async forEdit(
    principal: Principal,
    original: ProblemDocument,
    fields: Partial<Problem>,
  ): Promise<ReadonlyArray<keyof CreateProblemDto>> {
    const organizations = (fields.organizations ?? original.organizations).map(
      uuidStr,
    );
    const isOrganizationPrivate =
      fields.isOrganizationPrivate ?? original.isOrganizationPrivate;
    const moveWaiver = await this.authorizeMove(principal, scopeOf(original), {
      organizations,
      isOrganizationPrivate,
    });
    if (isOrganizationPrivate)
      await this.assertPrefixOnChange(
        principal,
        original,
        fields,
        organizations,
      );
    const mayPublishToMembers =
      fields.isPublic !== undefined &&
      isOrganizationPrivate &&
      (await this.rights.createsProblemsInAll(principal, organizations));
    return [
      ...moveWaiver,
      ...(mayPublishToMembers ? MEMBERS_ONLY_VISIBILITY : []),
    ];
  }

  /**
   * A change of the organization fields by an editor without `judge.edit_all_problem` (who keeps the staff gate's full
   * rights): the organization creation rule in every organization it adds or removes, and `judge.add_problem` to leave
   * them all for the site. Returns the staff gates it opens; 403 with an issue code on `organizations` otherwise.
   */
  private async authorizeMove(
    principal: Principal,
    before: OrganizationScope,
    after: OrganizationScope,
  ): Promise<ReadonlyArray<keyof CreateProblemDto>> {
    if (
      sameJson(before, after) ||
      hasPermission(principal, 'judge.edit_all_problem')
    )
      return [];
    const needed = organizationsToAuthorize(before, after);
    const isSiteMove = leavesForSite(before, after);
    if (!(await this.rights.createsProblemsInEach(principal, needed)))
      throw organizationRightsRefusal(
        ORGANIZATION_RIGHTS_ISSUE,
        'Adding or removing an organization needs the right to create problems in it',
      );
    if (isSiteMove && !hasPermission(principal, 'judge.add_problem'))
      throw organizationRightsRefusal(
        SITE_PROBLEM_RIGHTS_ISSUE,
        'Moving a problem out of every organization onto the site requires judge.add_problem',
      );
    return ORGANIZATION_FIELDS;
  }

  /** Whether the viewer manages this problem as an administrator of its organizations: it is organization-private and they may create problems for every one of them (the rule of `canPublishToMembers`). */
  async managesAsOrganization(
    principal: Principal,
    problem: Pick<ProblemDocument, 'isOrganizationPrivate' | 'organizations'>,
  ): Promise<boolean> {
    return (
      problem.isOrganizationPrivate &&
      (await this.rights.createsProblemsInAll(
        principal,
        problem.organizations.map(uuidStr),
      ))
    );
  }

  /** Only a new code of an organization-private problem must carry the prefix of its (new) first organization. Existing codes are never re-checked: a move between organizations, a flip to private or a reorder keeps the code (user decision 2026-10-14). */
  private async assertPrefixOnChange(
    principal: Principal,
    original: ProblemDocument,
    fields: Partial<Problem>,
    organizations: string[],
  ): Promise<void> {
    const code = fields.code ?? original.code;
    if (principal.isSuperuser || code === original.code) return;
    const slug = await this.rights.firstSlug(organizations);
    if (slug !== null)
      assertOrganizationCodePrefix(
        principal,
        code,
        organizationCodePrefix(slug),
      );
  }
}

const scopeOf = (problem: ProblemDocument): OrganizationScope => ({
  organizations: problem.organizations.map(uuidStr),
  isOrganizationPrivate: problem.isOrganizationPrivate,
});
