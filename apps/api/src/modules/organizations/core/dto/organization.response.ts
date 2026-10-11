import { organizationCodePrefix } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class OrganizationListItemResponse {
  id!: string;
  /** Unique identifier used in URLs. */
  slug!: string;
  name!: string;
  /** Short name shown beside members, at most 20 characters. */
  shortName!: string;
  /** Anyone may join; otherwise members need an approved request. */
  isOpen!: boolean;
  /** Hidden from lists for everyone but members, admins and staff. */
  isUnlisted!: boolean;
  /** Number of members. */
  memberCount!: number;
  /** Combined performance points of the members. */
  performancePoints!: number;
  /** Most members the organization may have; null for no limit. */
  slots!: number | null;
  /** What the code of a problem created for the organization must start with (`thpt-demo` → `thptdemo_`). */
  problemCodePrefix!: string;

  static from(organization: Organization): OrganizationListItemResponse {
    return {
      id: uuidStr(organization._id),
      slug: organization.slug,
      name: organization.name,
      shortName: organization.shortName,
      isOpen: organization.isOpen,
      isUnlisted: organization.isUnlisted,
      memberCount: organization.memberCount,
      performancePoints: organization.performancePoints,
      slots: organization.slots,
      problemCodePrefix: organizationCodePrefix(organization.slug),
    };
  }
}

export class OrganizationSummaryResponse {
  id!: string;
  slug!: string;
  name!: string;
  shortName!: string;
  isOpen!: boolean;

  static from(organization: Organization): OrganizationSummaryResponse {
    return {
      id: uuidStr(organization._id),
      slug: organization.slug,
      name: organization.name,
      shortName: organization.shortName,
      isOpen: organization.isOpen,
    };
  }
}

export class OrganizationViewerResponse {
  /** The viewer belongs to the organization. */
  isMember!: boolean;
  /** The viewer is an admin or holds judge.edit_all_organization. */
  canAdminister!: boolean;
  /** The viewer may create problems for the organization (`POST /organizations/{slug}/problems`): an administrator holding `judge.create_organization_problem`. */
  canCreateProblem!: boolean;
  /** The viewer may create contests for the organization (`POST /organizations/{slug}/contests`): an administrator holding `judge.create_private_contest`. */
  canCreateContest!: boolean;
  /** The viewer's pending join request (Task 6), else null. */
  pendingRequestId!: string | null;
}

export class OrganizationDetailResponse extends OrganizationListItemResponse {
  /** The about text rendered to HTML. */
  aboutHtml!: string;
  /** Markdown source, for the edit form: administrators only. */
  about!: string | null;
  /** URL or site path of a custom logo; empty for the default. */
  logoOverrideImage!: string;
  /** When the organization was created, ISO 8601. */
  createdAt!: Date;
  /** Administrators in their stored order. */
  admins!: UserSummaryResponse[];
  /** Null for anonymous viewers. */
  viewer!: OrganizationViewerResponse | null;
}
