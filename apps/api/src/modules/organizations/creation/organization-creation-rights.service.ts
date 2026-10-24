import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { organizationCodePrefix } from '@libs/community';
import { CI, Organization, uuidStr } from '@libs/database';
import type { FilterQuery, Model } from 'mongoose';
import {
  CREATION_PERMISSION,
  OrganizationAccess,
} from '../core/organization-access';
import type {
  CreationKind,
  OrganizationAccessView,
} from '../core/organization-access';

type CreateRule = (
  principal: Principal | null,
  organization: OrganizationAccessView,
) => boolean;

/** The organization a problem or contest is created for. */
export interface CreationTarget {
  id: string;
  /** What an organization problem's code must start with (`organizationCodePrefix`). */
  codePrefix: string;
  /** The organization's administrators: who an organization problem create may name as its authors and curators. */
  adminIds: string[];
}

/** Where the viewer may create one kind of object: site-wide, and for at least one administered organization. */
export interface CreationScope {
  site: boolean;
  organizations: boolean;
}

const LIVE = { deletedAt: null };

/** Whether the rule allows the viewer in every one of these organization rows. */
const allowedInRows = (
  principal: Principal,
  rows: Organization[],
  rule: CreateRule,
) => rows.every((row) => rule(principal, OrganizationAccess.accessView(row)));
/** What `OrganizationAccess.accessView` reads. */
const ACCESS_FIELDS = { _id: 1, isUnlisted: 1, adminIds: 1 };

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

  /**
   * Whether the viewer may create problems for every one of these live organizations (publishing an organization-private
   * problem to their members): rights in one organization never publish to another's members.
   */
  async createsProblemsInAll(
    principal: Principal,
    organizationIds: readonly string[],
  ): Promise<boolean> {
    const rows = await this.liveAccessRows(organizationIds);
    return (
      rows.length > 0 &&
      allowedInRows(principal, rows, OrganizationAccess.canCreateProblem)
    );
  }

  /** Whether every one of these ids is a live organization the viewer may create problems for: an unknown or deleted id refuses (moving a problem between organizations). */
  createsProblemsInEach(
    principal: Principal,
    organizationIds: readonly string[],
  ): Promise<boolean> {
    return this.allowsInEach(
      principal,
      organizationIds,
      OrganizationAccess.canCreateProblem,
    );
  }

  /** Whether every one of these ids is a live organization the viewer may create contests for: an unknown or deleted id refuses (moving a contest between organizations). */
  createsContestsInEach(
    principal: Principal,
    organizationIds: readonly string[],
  ): Promise<boolean> {
    return this.allowsInEach(
      principal,
      organizationIds,
      OrganizationAccess.canCreateContest,
    );
  }

  /** Whether every one of these ids is a live organization the viewer administers (`OrganizationAccess.canAdminister`). */
  administersEach(
    principal: Principal,
    organizationIds: readonly string[],
  ): Promise<boolean> {
    return this.allowsInEach(
      principal,
      organizationIds,
      OrganizationAccess.canAdminister,
    );
  }

  /** The slug of the first live organization in list order, whose prefix an organization problem's code carries; null for none. */
  async firstSlug(organizationIds: readonly string[]): Promise<string | null> {
    if (!organizationIds.length) return null;
    const rows = await this.organizations
      .find({ _id: { $in: organizationIds }, ...LIVE }, { slug: 1 })
      .lean<Pick<Organization, '_id' | 'slug'>[]>()
      .exec();
    const slugById = new Map(rows.map((row) => [uuidStr(row._id), row.slug]));
    const first = organizationIds.find((id) => slugById.has(id));
    return first === undefined ? null : (slugById.get(first) ?? null);
  }

  /** Whether the viewer may administer at least one live organization (an admin of one, or `judge.edit_all_organization`). */
  async administersAny(principal: Principal): Promise<boolean> {
    const filter = OrganizationAccess.administeredFilter(principal);
    if (filter === null) return false;
    if (Object.keys(filter).length === 0) return true;
    return (
      (await this.organizations.exists({ $and: [filter, LIVE] }).exec()) !==
      null
    );
  }

  /** Whether the viewer may create problems for at least one organization: the session's `problemCreation.organizations`. */
  async createsOrganizationProblems(principal: Principal): Promise<boolean> {
    if (!hasPermission(principal, CREATION_PERMISSION.problem)) return false;
    return this.administersAny(principal);
  }

  /** What the session reports, given whether the viewer administers any organization (`administersAny`): site-wide creation is the global permission, organization creation an administered organization plus the organization permission. */
  scopes(
    principal: Principal,
    administers: boolean,
  ): { problems: CreationScope; contests: CreationScope } {
    return {
      problems: {
        site: hasPermission(principal, 'judge.add_problem'),
        organizations:
          administers && hasPermission(principal, CREATION_PERMISSION.problem),
      },
      contests: {
        site: hasPermission(principal, 'judge.add_contest'),
        organizations:
          administers && hasPermission(principal, CREATION_PERMISSION.contest),
      },
    };
  }

  /**
   * Mongo filter of the organizations the viewer may create `kind` for: the list twin of `problemTarget`/`contestTarget`
   * (an administrator, or every organization with `judge.edit_all_organization`, who holds the kind's permission).
   * Null for nothing: anonymous, or without the permission.
   */
  creatableFilter(
    principal: Principal | null,
    kind: CreationKind,
  ): FilterQuery<Organization> | null {
    return principal !== null &&
      hasPermission(principal, CREATION_PERMISSION[kind])
      ? OrganizationAccess.administeredFilter(principal)
      : null;
  }

  private liveAccessRows(
    organizationIds: readonly string[],
  ): Promise<Organization[]> {
    return this.organizations
      .find({ _id: { $in: organizationIds }, ...LIVE }, ACCESS_FIELDS)
      .lean<Organization[]>()
      .exec();
  }

  private async allowsInEach(
    principal: Principal,
    organizationIds: readonly string[],
    rule: CreateRule,
  ): Promise<boolean> {
    const rows = await this.liveAccessRows(organizationIds);
    return (
      rows.length === new Set(organizationIds).size &&
      allowedInRows(principal, rows, rule)
    );
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
      codePrefix: organizationCodePrefix(organization.slug),
      adminIds: organization.adminIds.map(uuidStr),
    };
  }
}
