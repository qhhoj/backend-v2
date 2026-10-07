import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { RateLimitService } from '@libs/common';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_RESCORE_QUEUE,
} from '@libs/contests';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { ContestAccessModule } from './contest-access.module';
import { AnnouncementsRepository } from './announcements.repository';
import { ContestAnnouncementsController } from './contest-announcements.controller';
import { ContestAnnouncementsService } from './contest-announcements.service';
import { ContestEditingController } from './contest-editing.controller';
import { ContestEditingService } from './contest-editing.service';
import { ContestEventsService } from './contest-events.service';
import { ContestParticipationController } from './contest-participation.controller';
import { ContestParticipationService } from './contest-participation.service';
import { ContestRatingController } from './contest-rating.controller';
import { ContestRatingService } from './contest-rating.service';
import { ContestRankingController } from './contest-ranking.controller';
import { ContestRankingService } from './contest-ranking.service';
import { ContestSubmissionsController } from './contest-submissions.controller';
import { ContestSubmissionsService } from './contest-submissions.service';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';
import { OfficialRankingController } from './official-ranking.controller';
import { OfficialRankingService } from './official-ranking.service';
import { OfficialRankingsRepository } from './official-rankings.repository';
import { RankingLinksController } from './ranking-links.controller';
import { RankingLinksRepository } from './ranking-links.repository';
import { RankingLinksService } from './ranking-links.service';

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
    ),
  ],
  // Fastify matches a static segment (Task 7's `current`) before `:key`, whatever the controller order.
  controllers: [
    ContestAnnouncementsController,
    ContestEditingController,
    ContestParticipationController,
    ContestRankingController,
    ContestRatingController,
    ContestSubmissionsController,
    ContestsController,
    OfficialRankingController,
    RankingLinksController,
  ],
  providers: [
    AnnouncementsRepository,
    ContestAnnouncementsService,
    ContestEventsService,
    ContestsService,
    ContestEditingService,
    ContestParticipationService,
    ContestRankingService,
    ContestRatingService,
    ContestSubmissionsService,
    OfficialRankingService,
    OfficialRankingsRepository,
    RankingLinksRepository,
    RankingLinksService,
    RateLimitService,
  ],
})
export class ContestsApiModule {}
