import { Type } from '@nestjs/common';
import { Mapper } from '../../mapper';
import { ContestAnnouncementsMapper } from './contest-announcements.mapper';
import { ContestOfficialRankingsMapper } from './contest-official-rankings.mapper';
import { ContestRankingLinksMapper } from './contest-ranking-links.mapper';
import { ContestsMapper } from './contests.mapper';

/** This area's backfill jobs in run order. */
export const CONTESTS_MAPPERS: Type<Mapper>[] = [
  ContestsMapper,
  ContestAnnouncementsMapper,
  ContestRankingLinksMapper,
  ContestOfficialRankingsMapper,
];
