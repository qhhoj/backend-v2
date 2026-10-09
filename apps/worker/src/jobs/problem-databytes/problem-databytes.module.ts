import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PROBLEM_DATABYTES_QUEUE, ProblemFilesModule } from '@libs/problems';
import { ProblemDataBytesProcessor } from './problem-databytes.processor';
import { ProblemDataBytesRepository } from './problem-databytes.repository';
import { ProblemDataBytesService } from './problem-databytes.service';

@Module({
  imports: [
    ProblemFilesModule,
    BullModule.registerQueue({ name: PROBLEM_DATABYTES_QUEUE }),
  ],
  providers: [
    ProblemDataBytesProcessor,
    ProblemDataBytesService,
    ProblemDataBytesRepository,
  ],
})
export class ProblemDataBytesModule {}
