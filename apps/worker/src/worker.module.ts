import { Module } from '@nestjs/common';
import {
  EnvModule,
  QueueModule,
  RedisModule,
  StorageModule,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { ContestDataModule } from './jobs/contest-data/contest-data.module';
import { ContestFinalJudgeModule } from './jobs/contest-final-judge/contest-final-judge.module';
import { ContestRatingModule } from './jobs/contest-rating/contest-rating.module';
import { ContestMossModule } from './jobs/contest-moss/contest-moss.module';
import { ContestRescoreModule } from './jobs/contest-rescore/contest-rescore.module';
import { EffectsSweepModule } from './jobs/effects-sweep/effects-sweep.module';
import { OrganizationPointsModule } from './jobs/organization-points/organization-points.module';
import { PdfRenderModule } from './jobs/pdf-render/pdf-render.module';
import { PolygonImportModule } from './jobs/polygon-import/polygon-import.module';
import { ProblemRescoreModule } from './jobs/problem-rescore/problem-rescore.module';
import { SubmissionEffectsModule } from './jobs/submission-effects/submission-effects.module';
import { UserDataModule } from './jobs/user-data/user-data.module';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    StorageModule,
    QueueModule,
    RedisModule,
    ProblemFilesModule,
    PdfRenderModule,
    PolygonImportModule,
    SubmissionEffectsModule,
    EffectsSweepModule,
    ProblemRescoreModule,
    ContestRescoreModule,
    ContestFinalJudgeModule,
    ContestRatingModule,
    ContestMossModule,
    ContestDataModule,
    OrganizationPointsModule,
    UserDataModule,
  ],
})
export class WorkerModule {}
