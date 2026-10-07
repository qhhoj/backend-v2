import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated } from '@libs/common';
import { competitionRanks } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import { UserSummaryResponse } from '../../problems/core/dto/user-summary.response';
import { MemberResponse } from './dto/member.response';
import {
  MemberListQueryDto,
  OrganizationListQueryDto,
} from './dto/organization-params.dto';
import {
  OrganizationDetailResponse,
  OrganizationListItemResponse,
} from './dto/organization.response';
import { OrganizationAccess } from './organization-access';
import { OrganizationMembersRepository } from './organization-members.repository';
import { OrganizationRequestsRepository } from './organization-requests.repository';
import { OrganizationsRepository } from './organizations.repository';
import type { OrganizationDocument } from './organizations.repository';

const notFound = () => new AppError('not_found', 404, 'No such organization');

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizations: OrganizationsRepository,
    private readonly members: OrganizationMembersRepository,
    private readonly users: UsersRepository,
    private readonly requests: OrganizationRequestsRepository,
  ) {}

  /** Legacy `PublicOrganizationMixin`: any organization by slug, unlisted ones included (they are only kept out of enumerations). */
  async bySlug(slug: string): Promise<OrganizationDocument> {
    const organization = await this.organizations.findBySlug(slug);
    if (!organization) throw notFound();
    return organization;
  }

  async administered(
    principal: Principal,
    slug: string,
  ): Promise<OrganizationDocument> {
    const organization = await this.bySlug(slug);
    if (
      !OrganizationAccess.canAdminister(
        principal,
        OrganizationAccess.accessView(organization),
      )
    )
      throw new AppError(
        'forbidden',
        403,
        'You are not allowed to administer this organization',
      );
    return organization;
  }

  /** Legacy `OrganizationList`, plus the viewer's own unlisted ones. */
  async list(
    principal: Principal | null,
    { page, pageSize }: OrganizationListQueryDto,
  ): Promise<Paginated<OrganizationListItemResponse>> {
    const { items, total } = await this.organizations.list(
      OrganizationAccess.listFilter(principal),
      page,
      pageSize,
    );
    return new Paginated(
      items.map((organization) =>
        OrganizationListItemResponse.from(organization),
      ),
      { page, pageSize, total },
    );
  }

  /** A user's organizations in their order, without the unlisted ones the viewer may not see enumerated. */
  async listedFor(
    principal: Principal | null,
    organizationIds: readonly string[],
  ): Promise<Organization[]> {
    const byId = new Map(
      (await this.organizations.findByIds(organizationIds)).map(
        (organization) => [uuidStr(organization._id), organization],
      ),
    );
    return organizationIds.flatMap((id) => {
      const organization = byId.get(id);
      return organization &&
        OrganizationAccess.canList(
          principal,
          OrganizationAccess.accessView(organization),
        )
        ? [organization]
        : [];
    });
  }

  async detail(
    principal: Principal | null,
    slugOrOrganization: string | OrganizationDocument,
  ): Promise<OrganizationDetailResponse> {
    const organization =
      typeof slugOrOrganization === 'string'
        ? await this.bySlug(slugOrOrganization)
        : slugOrOrganization;
    const view = OrganizationAccess.accessView(organization);
    const canAdminister = OrganizationAccess.canAdminister(principal, view);
    const admins = await this.users.findByIds(view.adminIds);
    const pendingRequestId = principal
      ? await this.requests.pendingIdOf(view.id, principal.userId)
      : null;
    return {
      ...OrganizationListItemResponse.from(organization),
      aboutHtml: organization.aboutHtml,
      about: canAdminister ? organization.about : null,
      slots: organization.slots,
      logoOverrideImage: organization.logoOverrideImage,
      createdAt: organization.createdAt,
      // Admins keep their stored order.
      admins: view.adminIds.flatMap((id) =>
        admins
          .filter((admin) => uuidStr(admin._id) === id)
          .map((admin) => UserSummaryResponse.from(admin)),
      ),
      viewer: principal && {
        isMember: OrganizationAccess.isMember(principal, view.id),
        canAdminister,
        pendingRequestId,
      },
    };
  }

  /** Legacy `OrganizationUsers` with ranks over the chosen sort (legacy ranked by points from 1 on every page). */
  async membersOf(
    slug: string,
    { sort, page, pageSize }: MemberListQueryDto,
  ): Promise<Paginated<MemberResponse>> {
    const organization = await this.bySlug(slug);
    const { items, total } = await this.members.members(
      organization._id,
      sort,
      page,
      pageSize,
    );
    const values = items.map((row) => row[sort]);
    const firstRank = items.length
      ? (await this.members.countAbove(organization._id, sort, values[0])) + 1
      : 1;
    const ranks = competitionRanks(values, firstRank);
    return new Paginated(
      items.map((row, index) => MemberResponse.from(row, ranks[index])),
      { page, pageSize, total },
    );
  }
}
