import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { NOTIFICATION_FANOUT_QUEUE } from '@libs/community';
import { RateLimitService } from '@libs/common';
import {
  CONTEST_DATA_QUEUE,
  CONTEST_EXPORT_QUEUE,
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_PUBLISH_QUEUE,
  CONTEST_RATING_QUEUE,
  CONTEST_REPLAY_QUEUE,
  CONTEST_RESCORE_QUEUE,
} from '@libs/contests';
import { EventsModule } from '../events/events.module';
import { OrganizationQuotaModule } from '../organizations/quota/organization-quota.module';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { SubmissionsApiModule } from '../submissions/submissions-api.module';
import { ContestAccessModule } from './core/contest-access.module';
import { BalloonsModule } from './balloons/balloons.module';
import { ExportModule } from './export/export.module';
import { FeedModule } from './feed/feed.module';
import { ContestTagsModule } from './tags/contest-tags.module';
import { GhostsModule } from './ghosts/ghosts.module';
import { ReplayModule } from './replay/replay.module';
import { AnnouncementsRepository } from './announcements/announcements.repository';
import { ContestAnnouncementsController } from './announcements/contest-announcements.controller';
import { ContestAnnouncementsService } from './announcements/contest-announcements.service';
import { ContestDataController } from './data/contest-data.controller';
import { ContestDataService } from './data/contest-data.service';
import { ContestActionsService } from './editing/contest-actions.service';
import { ContestEditingController } from './editing/contest-editing.controller';
import { ContestEditFieldsService } from './editing/contest-edit-fields.service';
import { ContestEditingService } from './editing/contest-editing.service';
import { ContestEventsService } from './announcements/contest-events.service';
import { ContestStreamsController } from './announcements/contest-streams.controller';
import { ContestStreamsService } from './announcements/contest-streams.service';
import { ContestParticipationController } from './participation/contest-participation.controller';
import { ContestParticipationService } from './participation/contest-participation.service';
import { ContestPublishController } from './publish/contest-publish.controller';
import { ContestPublishService } from './publish/contest-publish.service';
import { ContestRatingController } from './rating/contest-rating.controller';
import { ContestRatingService } from './rating/contest-rating.service';
import { ContestRankingController } from './ranking/contest-ranking.controller';
import { ContestRankingService } from './ranking/contest-ranking.service';
import { ContestStatsController } from './stats/contest-stats.controller';
import { ContestStatsRepository } from './stats/contest-stats.repository';
import { ContestStatsService } from './stats/contest-stats.service';
import { ContestSubmissionsController } from './submissions/contest-submissions.controller';
import { ContestSubmissionsService } from './submissions/contest-submissions.service';
import { ContestProblemFactsService } from './core/contest-problem-facts.service';
import { ContestsController } from './core/contests.controller';
import { ContestsService } from './core/contests.service';
import { SolverCountsService } from './core/solver-counts.service';
import { OfficialRankingController } from './ranking/official-ranking.controller';
import { OfficialRankingService } from './ranking/official-ranking.service';
import { OfficialRankingsRepository } from './ranking/official-rankings.repository';
import { RankingUsersRepository } from './ranking/ranking-users.repository';
import { RankingLinksController } from './ranking/ranking-links.controller';
import { RankingLinksRepository } from './ranking/ranking-links.repository';
import { RankingLinksService } from './ranking/ranking-links.service';

@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    BalloonsModule,
    ExportModule,
    FeedModule,
    ContestTagsModule,
    GhostsModule,
    ReplayModule,
    EventsModule,
    OrganizationQuotaModule,
    ProblemsApiModule,
    SubmissionsApiModule,
    BullModule.registerQueue(
      { name: CONTEST_RESCORE_QUEUE },
      { name: CONTEST_FINAL_JUDGE_QUEUE },
      { name: CONTEST_PUBLISH_QUEUE },
      { name: CONTEST_RATING_QUEUE },
      { name: CONTEST_DATA_QUEUE },
      { name: CONTEST_REPLAY_QUEUE },
      { name: CONTEST_EXPORT_QUEUE },
      { name: NOTIFICATION_FANOUT_QUEUE },
    ),
  ],
  // Fastify matches a static segment (Task 7's `current`) before `:key`, whatever the controller order.
  controllers: [
    ContestAnnouncementsController,
    ContestDataController,
    ContestEditingController,
    ContestParticipationController,
    ContestPublishController,
    ContestRankingController,
    ContestRatingController,
    ContestStatsController,
    ContestStreamsController,
    ContestSubmissionsController,
    ContestsController,
    OfficialRankingController,
    RankingLinksController,
  ],
  providers: [
    AnnouncementsRepository,
    ContestActionsService,
    ContestAnnouncementsService,
    ContestDataService,
    ContestEventsService,
    ContestStreamsService,
    ContestsService,
    ContestProblemFactsService,
    ContestEditFieldsService,
    ContestEditingService,
    ContestParticipationService,
    ContestPublishService,
    ContestRankingService,
    ContestRatingService,
    ContestStatsRepository,
    ContestStatsService,
    ContestSubmissionsService,
    OfficialRankingService,
    OfficialRankingsRepository,
    RankingLinksRepository,
    RankingUsersRepository,
    RankingLinksService,
    RateLimitService,
    SolverCountsService,
  ],
  // The sync API (`SyncModule`) writes and reads contests through these.
  exports: [
    ContestEditingService,
    ContestEditFieldsService,
    ContestRankingService,
  ],
})
export class ContestsApiModule {}
