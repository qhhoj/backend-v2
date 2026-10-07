import { Injectable } from '@nestjs/common';
import type { FilterQuery } from 'mongoose';
import type { Principal } from '@libs/auth';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import { OrganizationAccess } from '../../organizations/core/organization-access';
import { OrganizationsRepository } from '../../organizations/core/organizations.repository';
import {
  API_V2_PAGE_SIZE,
  legacyPage,
  legacyTotalPages,
} from '../core/legacy-envelope';
import type { LegacyPage } from '../core/legacy-envelope';
import { ApiV2OrganizationListDto } from './dto/api-v2-organization-list.dto';

const notFound = () => new AppError('not_found', 404, 'page/object not found');

@Injectable()
export class ApiV2OrganizationsService {
  constructor(private readonly organizations: OrganizationsRepository) {}

  /** Legacy `APIOrganizationList`, without the unlisted organizations the viewer may not see. */
  async list(
    principal: Principal | null,
    query: ApiV2OrganizationListDto,
  ): Promise<LegacyPage<Record<string, unknown>>> {
    const clauses: FilterQuery<Organization>[] = [
      OrganizationAccess.listFilter(principal),
    ];
    if (query.is_open !== undefined) clauses.push({ isOpen: query.is_open });
    if (query.id) clauses.push({ _id: { $in: query.id } });
    const { items, total } = await this.organizations.legacyPage(
      { $and: clauses },
      query.page,
      API_V2_PAGE_SIZE,
    );
    if (query.page > legacyTotalPages(total)) throw notFound();
    return legacyPage(
      items.map((organization) => ({
        id: uuidStr(organization._id),
        slug: organization.slug,
        short_name: organization.shortName,
        is_open: organization.isOpen,
        member_count: organization.memberCount,
      })),
      query.page,
      total,
    );
  }
}
