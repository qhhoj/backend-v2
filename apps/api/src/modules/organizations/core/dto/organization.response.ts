import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import { UserSummaryResponse } from '../../../problems/core/dto/user-summary.response';

export class OrganizationListItemResponse {
  id!: string;
  slug!: string;
  name!: string;
  shortName!: string;
  isOpen!: boolean;
  isUnlisted!: boolean;
  memberCount!: number;
  performancePoints!: number;

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
    };
  }
}

export class OrganizationSummaryResponse {
  id!: string;
  slug!: string;
  name!: string;
  shortName!: string;

  static from(organization: Organization): OrganizationSummaryResponse {
    return {
      id: uuidStr(organization._id),
      slug: organization.slug,
      name: organization.name,
      shortName: organization.shortName,
    };
  }
}

export class OrganizationViewerResponse {
  isMember!: boolean;
  canAdminister!: boolean;
  /** The viewer's pending join request (Task 6), else null. */
  pendingRequestId!: string | null;
}

export class OrganizationDetailResponse extends OrganizationListItemResponse {
  aboutHtml!: string;
  /** Markdown source, for the edit form: administrators only. */
  about!: string | null;
  slots!: number | null;
  logoOverrideImage!: string;
  createdAt!: Date;
  admins!: UserSummaryResponse[];
  /** Null for anonymous viewers. */
  viewer!: OrganizationViewerResponse | null;
}
