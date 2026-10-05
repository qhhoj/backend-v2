import { Module } from '@nestjs/common';
import { EnvModule, QueueModule, StorageModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { PdfRenderModule } from './jobs/pdf-render/pdf-render.module';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    StorageModule,
    QueueModule,
    ProblemFilesModule,
    PdfRenderModule,
  ],
})
export class WorkerModule {}
