import { Module } from '@nestjs/common';
import { EnvModule, QueueModule, StorageModule } from '@libs/common';
import { DatabaseModule } from '@libs/database';
import { ProblemFilesModule } from '@libs/problems';
import { PdfRenderModule } from './jobs/pdf-render/pdf-render.module';
import { PolygonImportModule } from './jobs/polygon-import/polygon-import.module';

@Module({
  imports: [
    EnvModule,
    DatabaseModule,
    StorageModule,
    QueueModule,
    ProblemFilesModule,
    PdfRenderModule,
    PolygonImportModule,
  ],
})
export class WorkerModule {}
