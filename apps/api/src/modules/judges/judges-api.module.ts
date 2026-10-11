import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { JudgingModule } from '@libs/judging';
import { JudgesController } from './judges.controller';
import { JudgesRepository } from './judges.repository';
import { JudgesService } from './judges.service';
import { JudgeQueueRepository } from './queue/judge-queue.repository';
import { JudgeQueueService } from './queue/judge-queue.service';

@Module({
  imports: [AuthModule, JudgingModule],
  controllers: [JudgesController],
  providers: [
    JudgesService,
    JudgesRepository,
    JudgeQueueRepository,
    JudgeQueueService,
  ],
  exports: [JudgesRepository],
})
export class JudgesApiModule {}
