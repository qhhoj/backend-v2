import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { ContestSubmissionsMapper } from './contest-submissions.mapper';
import { ParticipationsMapper } from './participations.mapper';

/** This area's backfill jobs in run order. */
export const CONTEST_RESULTS_MAPPERS: Type<Mapper>[] = [
  ParticipationsMapper,
  ContestSubmissionsMapper,
];
