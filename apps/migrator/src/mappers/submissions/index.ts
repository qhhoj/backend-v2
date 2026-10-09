import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { SubmissionsMapper } from './submissions.mapper';

/** This area's backfill jobs in run order. */
export const SUBMISSIONS_MAPPERS: Type<Mapper>[] = [SubmissionsMapper];
