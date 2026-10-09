import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { ProblemsMapper } from './problems.mapper';

/** This area's backfill jobs in run order. */
export const PROBLEMS_MAPPERS: Type<Mapper>[] = [ProblemsMapper];
