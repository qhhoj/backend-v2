import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import type { SubmissionListQueryDto } from '../../submissions/core/dto/submission-list.dto';
import type { SubmissionListItemResponse } from '../../submissions/core/dto/submission-list.response';
import { SubmissionsService } from '../../submissions/core/submissions.service';
import { OrganizationAccess } from '../core/organization-access';
import type { OrganizationAccessView } from '../core/organization-access';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import { OrganizationsService } from '../core/organizations.service';

/** Legacy `SubmissionListOrganization` (a `PrivateOrganizationMixin` view): the listed members' submissions, under the site list's visibility rules. */
@Injectable()
export class OrganizationSubmissionsService {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly members: OrganizationMembersRepository,
    private readonly submissions: SubmissionsService,
  ) {}

  async list(
    principal: Principal,
    slug: string,
    query: SubmissionListQueryDto,
  ): Promise<Paginated<SubmissionListItemResponse>> {
    const organization = await this.organizations.bySlug(slug);
    const view = OrganizationAccess.accessView(organization);
    if (!this.mayRead(principal, view))
      throw new AppError(
        'forbidden',
        403,
        "Only members may see this organization's submissions",
      );
    const userIds = await this.members.listedMemberIds(view.id);
    if (!userIds.length)
      return new Paginated([], {
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
      });
    return this.submissions.list(principal, query, { userIds });
  }

  /** Members, administrators, and the legacy `permission_bypass` `judge.view_all_submission`. */
  private mayRead(principal: Principal, view: OrganizationAccessView): boolean {
    return (
      OrganizationAccess.isMember(principal, view.id) ||
      OrganizationAccess.canAdminister(principal, view) ||
      hasPermission(principal, 'judge.view_all_submission')
    );
  }
}
