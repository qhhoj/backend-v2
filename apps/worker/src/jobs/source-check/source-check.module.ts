import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ProblemFilesModule, SOURCE_CHECK_QUEUE } from '@libs/problems';
import { PolygonImportModule } from '../polygon-import/polygon-import.module';
import { SourceCheckProcessor } from './source-check.processor';
import { SourceCheckRepository } from './source-check.repository';
import { SourceCheckService } from './source-check.service';

@Module({
  imports: [
    PolygonImportModule,
    ProblemFilesModule,
    BullModule.registerQueue({ name: SOURCE_CHECK_QUEUE }),
  ],
  providers: [SourceCheckProcessor, SourceCheckService, SourceCheckRepository],
})
export class SourceCheckModule {}
