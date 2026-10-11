import { Injectable } from '@nestjs/common';
import type { FilterQuery } from 'mongoose';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, unique } from '@libs/common';
import { competitionRanks } from '@libs/community';
import { narrowTo, uuidStr } from '@libs/database';
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
import {
  organizationSearchFilter,
  type OrganizationDocument,
} from './organizations.repository';

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

  /** Whether the viewer may administer at least one organization (an admin of one, or `edit_all_organization`). */
  async administersAny(principal: Principal): Promise<boolean> {
    const filter = OrganizationAccess.administeredFilter(principal);
    if (filter === null) return false;
    return (
      Object.keys(filter).length === 0 || this.organizations.exists(filter)
    );
  }

  /** Legacy `OrganizationList`, plus the viewer's own unlisted ones. Search and flags only narrow what the viewer may already list. */
  async list(
    principal: Principal | null,
    query: OrganizationListQueryDto,
  ): Promise<Paginated<OrganizationListItemResponse>> {
    const { page, pageSize, administered } = query;
    const clauses = [
      OrganizationAccess.listFilter(principal),
      this.narrowing(query),
    ];
    if (administered !== undefined)
      clauses.push(
        narrowTo(
          OrganizationAccess.administeredFilter(principal),
          administered,
        ),
      );
    const { items, total } = await this.organizations.list(
      { $and: clauses },
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

  private narrowing({
    search,
    open,
    unlisted,
  }: OrganizationListQueryDto): FilterQuery<Organization> {
    return {
      ...(search ? organizationSearchFilter(search) : {}),
      ...(open === undefined ? {} : { isOpen: open }),
      ...(unlisted === undefined ? {} : { isUnlisted: unlisted }),
    };
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

  /** The first listed organization of each user, for lists any visitor sees (unlisted ones are skipped, whoever views). Keyed by user id. */
  async firstListedByUser(
    rows: ReadonlyArray<{ _id: string; organizations: readonly string[] }>,
  ): Promise<Map<string, Organization>> {
    const listed = new Map(
      (
        await this.organizations.findByIds(
          unique(rows.flatMap((row) => row.organizations.map(uuidStr))),
        )
      )
        .filter((organization) =>
          OrganizationAccess.canList(
            null,
            OrganizationAccess.accessView(organization),
          ),
        )
        .map((organization) => [uuidStr(organization._id), organization]),
    );
    return new Map(
      rows.flatMap((row) => {
        const first = row.organizations
          .map((id) => listed.get(uuidStr(id)))
          .find(Boolean);
        return first ? [[uuidStr(row._id), first] as const] : [];
      }),
    );
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

  /** Legacy `OrganizationUsers` with ranks over the chosen sort (legacy ranked by points from 1 on every page); with `search`, ranks count matching members only. */
  async membersOf(
    slug: string,
    query: MemberListQueryDto,
  ): Promise<Paginated<MemberResponse>> {
    const { sort, page, pageSize } = query;
    const organization = await this.bySlug(slug);
    const { items, total } = await this.members.members(
      organization._id,
      query,
    );
    const values = items.map((row) => row[sort]);
    const firstRank = items.length
      ? (await this.members.countAbove(organization._id, query, values[0])) + 1
      : 1;
    const ranks = competitionRanks(values, firstRank);
    return new Paginated(
      items.map((row, index) => MemberResponse.from(row, ranks[index])),
      { page, pageSize, total },
    );
  }
}
