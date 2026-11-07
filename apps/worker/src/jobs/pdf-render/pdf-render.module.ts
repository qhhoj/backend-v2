import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { problemJobs, ProblemFilesModule } from '@libs/problems';
import { BrowserService } from './browser.service';
import { PdfRenderProcessor } from './pdf-render.processor';
import { PdfRenderRepository } from './pdf-render.repository';
import { PdfRenderService } from './pdf-render.service';

@Module({
  imports: [ProblemFilesModule, JobsModule.register(problemJobs.pdf)],
  providers: [
    PdfRenderProcessor,
    PdfRenderService,
    PdfRenderRepository,
    BrowserService,
  ],
})
export class PdfRenderModule {}
