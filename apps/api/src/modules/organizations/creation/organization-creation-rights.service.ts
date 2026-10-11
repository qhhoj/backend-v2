import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { organizationCodePrefix } from '@libs/community';
import { CI, Organization, uuidStr } from '@libs/database';
import type { Model } from 'mongoose';
import { OrganizationAccess } from '../core/organization-access';
import type { OrganizationAccessView } from '../core/organization-access';

type CreateRule = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) => boolean;

/** The organization a problem or contest is created for. */
export interface CreationTarget {
  id: string;
  slug: string;
  /** What an organization problem's code must start with (`organizationCodePrefix`). */
  codePrefix: string;
}

/** Where the viewer may create one kind of object: site-wide, and for at least one administered organization. */
export interface CreationScope {
  site: boolean;
  organizations: boolean;
}

const LIVE = { deletedAt: null };

/**
 * The one place that decides who creates problems and contests for an organization (`OrganizationAccess.canCreate*`):
 * the organization routes, the organization page's viewer flags and the session's creation scopes all read it.
 * Only global modules underneath, so problems and contests import it without a cycle.
 */
@Injectable()
export class OrganizationCreationRights {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
  ) {}

  /** 404 for a missing organization, 403 unless the viewer may create problems for it. */
  problemTarget(principal: Principal, slug: string): Promise<CreationTarget> {
    return this.target(principal, slug, OrganizationAccess.canCreateProblem);
  }

  /** 404 for a missing organization, 403 unless the viewer may create contests for it. */
  contestTarget(principal: Principal, slug: string): Promise<CreationTarget> {
    return this.target(principal, slug, OrganizationAccess.canCreateContest);
  }

  /** Whether the viewer may create problems for any of these organizations (publishing an organization-private problem to its members). */
  async createsProblemsInAny(
    principal: Principal,
    organizationIds: readonly string[],
  ): Promise<boolean> {
    if (!organizationIds.length) return false;
    const rows = await this.organizations
      .find({ _id: { $in: organizationIds }, ...LIVE })
      .lean<Organization[]>()
      .exec();
    return rows.some((row) =>
      OrganizationAccess.canCreateProblem(
        principal,
        OrganizationAccess.accessView(row),
      ),
    );
  }

  /** The slug of the first listed live organization, whose prefix an organization problem's code carries; null for none. */
  async firstSlug(organizationIds: readonly string[]): Promise<string | null> {
    const [first] = organizationIds;
    if (first === undefined) return null;
    const row = await this.organizations
      .findOne({ _id: first, ...LIVE }, { slug: 1 })
      .lean<Pick<Organization, 'slug'>>()
      .exec();
    return row?.slug ?? null;
  }

  /** What the session reports, given whether the viewer administers any organization (`OrganizationsService.administersAny`): site-wide creation is the global permission, organization creation an administered organization plus the organization permission. */
  scopes(
    principal: Principal,
    administers: boolean,
  ): { problems: CreationScope; contests: CreationScope } {
    return {
      problems: {
        site: hasPermission(principal, 'judge.add_problem'),
        organizations:
          administers &&
          hasPermission(principal, 'judge.create_organization_problem'),
      },
      contests: {
        site: hasPermission(principal, 'judge.add_contest'),
        organizations:
          administers &&
          hasPermission(principal, 'judge.create_private_contest'),
      },
    };
  }

  private async target(
    principal: Principal,
    slug: string,
    rule: CreateRule,
  ): Promise<CreationTarget> {
    const organization = await this.organizations
      .findOne({ slug, ...LIVE })
      .collation(CI)
      .exec();
    if (!organization)
      throw new AppError('not_found', 404, 'No such organization');
    if (!rule(principal, OrganizationAccess.accessView(organization)))
      throw new AppError(
        'forbidden',
        403,
        'You are not allowed to create this for the organization',
      );
    return {
      id: uuidStr(organization._id),
      slug: organization.slug,
      codePrefix: organizationCodePrefix(organization.slug),
    };
  }
}
