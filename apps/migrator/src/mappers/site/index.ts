import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { FlatpagesMapper } from './flatpages.mapper';
import { GeneralIssuesMapper } from './general-issues.mapper';
import { MiscConfigMapper } from './misc-config.mapper';
import { NavigationMapper } from './navigation.mapper';
import { TicketsMapper } from './tickets.mapper';

/** This area's backfill jobs in run order. */
export const SITE_MAPPERS: Type<Mapper>[] = [
  GeneralIssuesMapper,
  TicketsMapper,
  FlatpagesMapper,
  MiscConfigMapper,
  NavigationMapper,
];
