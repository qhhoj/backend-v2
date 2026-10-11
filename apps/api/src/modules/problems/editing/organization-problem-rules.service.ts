import { Injectable } from '@nestjs/common';
import type { Principal } from '@libs/auth';
import { sameJson } from '@libs/common';
import { organizationCodePrefix } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import type { CreateProblemDto } from './dto/problem-edit.dto';
import { assertOrganizationCodePrefix } from './organization-code-prefix';
import { MEMBERS_ONLY_VISIBILITY } from './problem-edit-policy.service';
import type { ProblemDocument } from '../core/problems.repository';

/** The organization rules of a problem edit: the code prefix and members-only publishing by organization creators. */
@Injectable()
export class OrganizationProblemRules {
  constructor(private readonly rights: OrganizationCreationRights) {}

  /** Checks the prefix when the code or the organizations change, and returns the gates the editor may skip. */
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
    return mayPublishToMembers ? MEMBERS_ONLY_VISIBILITY : [];
  }

  /** Existing codes are never re-checked: only a new code, or a new organization list, of an organization-private problem (a site problem merely listed under an organization keeps its code). */
  private async assertPrefixOnChange(
    principal: Principal,
    original: ProblemDocument,
    fields: Partial<Problem>,
    organizations: string[],
  ): Promise<void> {
    const code = fields.code ?? original.code;
    const isRenamed = code !== original.code;
    const isRelisted =
      fields.organizations !== undefined &&
      !sameJson(organizations, original.organizations.map(uuidStr));
    if (principal.isSuperuser || !(isRenamed || isRelisted)) return;
    const slug = await this.rights.firstSlug(organizations);
    if (slug !== null)
      assertOrganizationCodePrefix(
        principal,
        code,
        organizationCodePrefix(slug),
      );
  }
}
