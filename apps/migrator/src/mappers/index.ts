import { Provider } from '@nestjs/common';
import { Mapper, MAPPERS } from '../mapper';
import { CATALOG_MAPPERS } from './catalogs';
import { COMMUNITY_MAPPERS } from './community';
import { CONTEST_RESULTS_MAPPERS } from './contest-results';
import { CONTESTS_MAPPERS } from './contests';
import { GroupsMapper } from './groups.mapper';
import { ORGANIZATIONS_MAPPERS } from './organizations';
import { PROBLEMS_MAPPERS } from './problems';
import { SITE_MAPPERS } from './site';
import { SUBMISSIONS_MAPPERS } from './submissions';
import { USERS_MAPPERS } from './users';

/** Backfill jobs in run order (references resolve through the id map, so order matters only for reading the logs); each area lists its own. */
const ORDER = [
  GroupsMapper,
  ...USERS_MAPPERS,
  ...ORGANIZATIONS_MAPPERS,
  ...CATALOG_MAPPERS,
  ...PROBLEMS_MAPPERS,
  ...CONTESTS_MAPPERS,
  ...CONTEST_RESULTS_MAPPERS,
  ...SUBMISSIONS_MAPPERS,
  ...COMMUNITY_MAPPERS,
  ...SITE_MAPPERS,
];

export const mapperProviders: Provider[] = [
  ...ORDER,
  {
    provide: MAPPERS,
    useFactory: (...mappers: Mapper[]) => mappers,
    inject: ORDER,
  },
];
