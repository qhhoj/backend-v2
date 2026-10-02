import { Provider } from '@nestjs/common';
import { Mapper, MAPPERS } from '../mapper';
import { GroupsMapper } from './groups.mapper';

/** Backfill jobs in run order; add new mappers here. */
const ORDER = [GroupsMapper];

export const mapperProviders: Provider[] = [
  ...ORDER,
  {
    provide: MAPPERS,
    useFactory: (...mappers: Mapper[]) => mappers,
    inject: ORDER,
  },
];
