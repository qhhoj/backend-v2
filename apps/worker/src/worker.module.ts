import { Module } from '@nestjs/common';
import {
  EnvModule,
  QueueModule,
  RedisModule,
  StorageModule,
} from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { PdfRenderModule } from './jobs/pdf-render/pdf-render.module';
import { PolygonImportModule } from './jobs/polygon-import/polygon-import.module';
import { SubmissionEffectsModule } from './jobs/submission-effects/submission-effects.module';

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
  ],
})
export class WorkerModule {}
