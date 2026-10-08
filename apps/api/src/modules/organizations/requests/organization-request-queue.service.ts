import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import { Paginated, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import {
  OrganizationRequestsRepository,
  ORGANIZATION_REQUEST_PAGE_SIZE,
} from '../core/organization-requests.repository';
import { OrganizationsRepository } from '../core/organizations.repository';
import { OrganizationRequestListQueryDto } from './dto/organization-request.dto';
import { OrganizationRequestResponse } from './dto/organization-request.response';

@Injectable()
export class OrganizationRequestQueueService {
  constructor(
    private readonly requests: OrganizationRequestsRepository,
    private readonly organizations: OrganizationsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** The staff queue across organizations: one state at a time, newest first. */
  async list({
    state,
    page,
  }: OrganizationRequestListQueryDto): Promise<
    Paginated<OrganizationRequestResponse>
  > {
    const { items, total } = await this.requests.listAll(
      state,
      page,
      ORGANIZATION_REQUEST_PAGE_SIZE,
    );
    const [organizations, users] = await Promise.all([
      this.organizations.findByIds(
        unique(items.map((row) => uuidStr(row.organization))),
      ),
      this.users.findByIds(unique(items.map((row) => uuidStr(row.user)))),
    ]);
    const slugById = new Map(
      organizations.map((organization) => [
        uuidStr(organization._id),
        organization.slug,
      ]),
    );
    const usernameById = new Map(
      users.map((user) => [uuidStr(user._id), user.username]),
    );
    return new Paginated(
      items.map((row) =>
        OrganizationRequestResponse.from(
          row,
          slugById.get(uuidStr(row.organization)) ?? '',
          usernameById.get(uuidStr(row.user)) ?? '',
        ),
      ),
      { page, pageSize: ORGANIZATION_REQUEST_PAGE_SIZE, total },
    );
  }
}
