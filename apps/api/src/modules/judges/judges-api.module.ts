import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { JudgingModule } from '@libs/judging';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { JudgesController } from './judges.controller';
import { JudgesRepository } from './judges.repository';
import { JudgesService } from './judges.service';
import { JudgeQueueRepository } from './queue/judge-queue.repository';
import { JudgeQueueService } from './queue/judge-queue.service';
import { RuntimesController } from './runtimes/runtimes.controller';
import { RuntimesService } from './runtimes/runtimes.service';

@Module({
  imports: [AuthModule, JudgingModule, ProblemsApiModule],
  controllers: [JudgesController, RuntimesController],
  providers: [
    JudgesService,
    RuntimesService,
    JudgesRepository,
    JudgeQueueRepository,
    JudgeQueueService,
  ],
  exports: [JudgesRepository],
})
export class JudgesApiModule {}
