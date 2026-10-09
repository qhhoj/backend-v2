import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';

/** This area's backfill jobs in run order; the lane fills it. */
export const SUBMISSIONS_MAPPERS: Type<Mapper>[] = [];
