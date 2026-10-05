import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PDF_QUEUE, POLYGON_QUEUE, ProblemFilesModule } from '@libs/problems';
import { PandocService } from './pandoc.service';
import { PolygonImportProcessor } from './polygon-import.processor';
import { PolygonImportRepository } from './polygon-import.repository';
import { PolygonImportService } from './polygon-import.service';

@Module({
  imports: [
    ProblemFilesModule,
    BullModule.registerQueue({ name: POLYGON_QUEUE }, { name: PDF_QUEUE }),
  ],
  providers: [
    PolygonImportProcessor,
    PolygonImportService,
    PolygonImportRepository,
    PandocService,
  ],
})
export class PolygonImportModule {}
