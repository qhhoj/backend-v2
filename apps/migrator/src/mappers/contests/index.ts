import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { ContestsMapper } from './contests.mapper';

/** This area's backfill jobs in run order. */
export const CONTESTS_MAPPERS: Type<Mapper>[] = [ContestsMapper];
