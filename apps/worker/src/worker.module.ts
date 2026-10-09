import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  EnvModule,
  QueueModule,
  RedisModule,
  StorageModule,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { SettingsModule } from '@libs/settings';
import { ContestDataModule } from './jobs/contest-data/contest-data.module';
import { ContestExportModule } from './jobs/contest-export/contest-export.module';
import { ContestFinalJudgeModule } from './jobs/contest-final-judge/contest-final-judge.module';
import { ContestRatingModule } from './jobs/contest-rating/contest-rating.module';
import { SimilarityModule } from './jobs/similarity/similarity.module';
import { ContestReplayModule } from './jobs/contest-replay/contest-replay.module';
import { ContestRescoreModule } from './jobs/contest-rescore/contest-rescore.module';
import { EffectsSweepModule } from './jobs/effects-sweep/effects-sweep.module';
import { MigrationRecomputeModule } from './jobs/migration-recompute/migration-recompute.module';
import { OrganizationPointsModule } from './jobs/organization-points/organization-points.module';
import { PdfRenderModule } from './jobs/pdf-render/pdf-render.module';
import { PolygonImportModule } from './jobs/polygon-import/polygon-import.module';
import { ProblemRescoreModule } from './jobs/problem-rescore/problem-rescore.module';
import { ProblemSolversModule } from './jobs/problem-solvers/problem-solvers.module';
import { SubmissionEffectsModule } from './jobs/submission-effects/submission-effects.module';
import { UserDataModule } from './jobs/user-data/user-data.module';
import { ContributionPointsModule } from './jobs/contribution-points/contribution-points.module';
import { DiscordWebhookModule } from './jobs/discord-webhook/discord-webhook.module';
import { NotificationFanoutModule } from './jobs/notification-fanout/notification-fanout.module';
import { NotificationTrimModule } from './jobs/notification-trim/notification-trim.module';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    StorageModule,
    QueueModule,
    RedisModule,
    ScheduleModule.forRoot(),
    SettingsModule,
    ProblemFilesModule,
    PdfRenderModule,
    PolygonImportModule,
    SubmissionEffectsModule,
    EffectsSweepModule,
    ProblemRescoreModule,
    ProblemSolversModule,
    ContestRescoreModule,
    ContestReplayModule,
    ContestFinalJudgeModule,
    ContestRatingModule,
    SimilarityModule,
    ContestDataModule,
    ContestExportModule,
    OrganizationPointsModule,
    ContributionPointsModule,
    UserDataModule,
    DiscordWebhookModule,
    MigrationRecomputeModule,
    NotificationFanoutModule,
    NotificationTrimModule,
  ],
})
export class WorkerModule {}
