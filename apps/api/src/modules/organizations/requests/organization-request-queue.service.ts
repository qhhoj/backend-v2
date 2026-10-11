import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { Paginated, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { OrganizationRequestState } from '@libs/database';
import { OrganizationMembersRepository } from '../core/organization-members.repository';
import {
  OrganizationRequestsRepository,
  ORGANIZATION_REQUEST_PAGE_SIZE,
} from '../core/organization-requests.repository';
import type { RequestQueueMatch } from '../core/organization-requests.repository';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationRequestQueueQueryDto } from './dto/organization-request.dto';
import { requestUsernames } from './request-usernames';
import { OrganizationRequestResponse } from './dto/organization-request.response';

@Injectable()
export class OrganizationRequestQueueService {
  constructor(
    private readonly requests: OrganizationRequestsRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly users: UsersRepository,
    private readonly members: OrganizationMembersRepository,
  ) {}

  /** The staff queue across organizations: one state at a time, newest first, optionally narrowed by a search. */
  async list({
    state,
    page,
    search,
  }: OrganizationRequestQueueQueryDto): Promise<
    Paginated<OrganizationRequestResponse>
  > {
    const { items, total } = await this.requests.listAll(
      state,
      page,
      ORGANIZATION_REQUEST_PAGE_SIZE,
      search ? await this.matching(state, search) : undefined,
    );
    const [organizations, usernameById] = await Promise.all([
      this.organizations.findByIds(
        unique(items.map((row) => uuidStr(row.organization))),
        { includeDeleted: true },
      ),
      requestUsernames(this.users, items),
    ]);
    const slugById = new Map(
      organizations.map((organization) => [
        uuidStr(organization._id),
        organization.slug,
      ]),
    );
    return new Paginated(
      items.map((row) =>
        OrganizationRequestResponse.from(
          row,
          slugById.get(uuidStr(row.organization)) ?? '',
          usernameById,
        ),
      ),
      { page, pageSize: ORGANIZATION_REQUEST_PAGE_SIZE, total },
    );
  }

  /** Requesters in `state` whose username matches, and organizations whose name, short name or slug matches. */
  private async matching(
    state: OrganizationRequestState,
    search: string,
  ): Promise<RequestQueueMatch> {
    const [userIds, organizationIds] = await Promise.all([
      this.requests
        .requesterIds(state)
        .then((ids) => this.members.idsWithUsername(ids, search)),
      this.organizations.idsMatching(search),
    ]);
    return { userIds, organizationIds };
  }
}
