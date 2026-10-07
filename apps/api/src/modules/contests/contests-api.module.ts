import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import {
  CONTEST_DATA_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_MOSS_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_RESCORE_QUEUE,
} from '@libs/contests';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { ContestAccessModule } from './core/contest-access.module';
import { AnnouncementsRepository } from './announcements/announcements.repository';
import { ContestAnnouncementsController } from './announcements/contest-announcements.controller';
import { ContestAnnouncementsService } from './announcements/contest-announcements.service';
import { ContestDataController } from './data/contest-data.controller';
import { ContestDataService } from './data/contest-data.service';
import { ContestEditingController } from './editing/contest-editing.controller';
import { ContestEditingService } from './editing/contest-editing.service';
import { ContestEventsService } from './announcements/contest-events.service';
import { ContestMossController } from './moss/contest-moss.controller';
import { ContestMossRepository } from './moss/contest-moss.repository';
import { ContestMossService } from './moss/contest-moss.service';
import { ContestParticipationController } from './participation/contest-participation.controller';
import { ContestParticipationService } from './participation/contest-participation.service';
import { ContestRatingController } from './rating/contest-rating.controller';
import { ContestRatingService } from './rating/contest-rating.service';
import { ContestRankingController } from './ranking/contest-ranking.controller';
import { ContestRankingService } from './ranking/contest-ranking.service';
import { ContestStatsController } from './stats/contest-stats.controller';
import { ContestStatsRepository } from './stats/contest-stats.repository';
import { ContestStatsService } from './stats/contest-stats.service';
import { ContestSubmissionsController } from './submissions/contest-submissions.controller';
import { ContestSubmissionsService } from './submissions/contest-submissions.service';
import { ContestsController } from './core/contests.controller';
import { ContestsService } from './core/contests.service';
import { OfficialRankingController } from './ranking/official-ranking.controller';
import { OfficialRankingService } from './ranking/official-ranking.service';
import { OfficialRankingsRepository } from './ranking/official-rankings.repository';
import { RatingsRepository } from './rating/ratings.repository';
import { RankingLinksController } from './ranking/ranking-links.controller';
import { RankingLinksRepository } from './ranking/ranking-links.repository';
import { RankingLinksService } from './ranking/ranking-links.service';

@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ProblemsApiModule,
    SubmissionsApiModule,
    BullModule.registerQueue(
      { name: CONTEST_RESCORE_QUEUE },
      { name: CONTEST_FINAL_JUDGE_QUEUE },
      { name: CONTEST_RATING_QUEUE },
      { name: CONTEST_MOSS_QUEUE },
      { name: CONTEST_DATA_QUEUE },
    ),
  ],
  // Fastify matches a static segment (Task 7's `current`) before `:key`, whatever the controller order.
  controllers: [
    ContestAnnouncementsController,
    ContestDataController,
    ContestEditingController,
    ContestMossController,
    ContestParticipationController,
    ContestRankingController,
    ContestRatingController,
    ContestStatsController,
    ContestSubmissionsController,
    ContestsController,
    OfficialRankingController,
    RankingLinksController,
  ],
  providers: [
    AnnouncementsRepository,
    ContestAnnouncementsService,
    ContestDataService,
    ContestEventsService,
    ContestMossRepository,
    ContestMossService,
    ContestsService,
    ContestEditingService,
    ContestParticipationService,
    ContestRankingService,
    ContestRatingService,
    ContestStatsRepository,
    ContestStatsService,
    ContestSubmissionsService,
    OfficialRankingService,
    OfficialRankingsRepository,
    RankingLinksRepository,
    RankingLinksService,
    RateLimitService,
    RatingsRepository,
  ],
  exports: [RatingsRepository],
})
export class ContestsApiModule {}
