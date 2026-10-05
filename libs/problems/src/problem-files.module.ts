import { Global, Module } from '@nestjs/common';
import { PdfCacheService } from './pdf-cache.service';
import { ProblemDataFilesService } from './problem-data-files.service';

@Global()
@Module({
  providers: [ProblemDataFilesService, PdfCacheService],
  exports: [ProblemDataFilesService, PdfCacheService],
})
export class ProblemFilesModule {}
