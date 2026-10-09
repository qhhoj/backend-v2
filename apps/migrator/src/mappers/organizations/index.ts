import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { OrganizationsMapper } from './organizations.mapper';
import { OrganizationRequestsMapper } from './organization-requests.mapper';

/** This area's backfill jobs in run order. */
export const ORGANIZATIONS_MAPPERS: Type<Mapper>[] = [
  OrganizationsMapper,
  OrganizationRequestsMapper,
];
