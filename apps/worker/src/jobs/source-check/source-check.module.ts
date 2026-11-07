import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs, ProblemFilesModule } from '@libs/problems';
import { PolygonImportModule } from '../polygon-import/polygon-import.module';
import { SourceCheckProcessor } from './source-check.processor';
import { SourceCheckRepository } from './source-check.repository';
import { SourceCheckService } from './source-check.service';

@Module({
  imports: [
    PolygonImportModule,
    ProblemFilesModule,
    JobsModule.register(problemJobs.sourceCheck),
  ],
  providers: [SourceCheckProcessor, SourceCheckService, SourceCheckRepository],
})
export class SourceCheckModule {}
