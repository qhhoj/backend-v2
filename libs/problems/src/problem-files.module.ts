import { Global, Module } from '@nestjs/common';
import { PackageCacheService } from './package-cache.service';
import { PdfCacheService } from './pdf-cache.service';
import { ProblemDataFilesService } from './problem-data-files.service';

@Global()
@Module({
  providers: [ProblemDataFilesService, PdfCacheService, PackageCacheService],
  exports: [ProblemDataFilesService, PdfCacheService, PackageCacheService],
})
export class ProblemFilesModule {}
