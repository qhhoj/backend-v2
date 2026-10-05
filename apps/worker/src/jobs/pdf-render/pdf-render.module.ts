import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PDF_QUEUE, ProblemFilesModule } from '@libs/problems';
import { BrowserService } from './browser.service';
import { PdfRenderProcessor } from './pdf-render.processor';
import { PdfRenderRepository } from './pdf-render.repository';
import { PdfRenderService } from './pdf-render.service';

@Module({
  imports: [ProblemFilesModule, BullModule.registerQueue({ name: PDF_QUEUE })],
  providers: [
    PdfRenderProcessor,
    PdfRenderService,
    PdfRenderRepository,
    BrowserService,
  ],
})
export class PdfRenderModule {}
