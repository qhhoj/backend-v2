import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { JudgingModule } from '@libs/judging';
import { CatalogApiModule } from '../problems/catalog/catalog-api.module';
import { SharedApiModule } from '../shared/shared-api.module';
import { JudgesController } from './judges.controller';
import { JudgeRunsRepository } from './judge-runs.repository';
import { JudgesRepository } from './judges.repository';
import { JudgesService } from './judges.service';
import { JudgeQueueRepository } from './queue/judge-queue.repository';
import { JudgeQueueService } from './queue/judge-queue.service';
import { RuntimesController } from './runtimes/runtimes.controller';
import { RuntimesService } from './runtimes/runtimes.service';

@Module({
  imports: [AuthModule, JudgingModule, CatalogApiModule, SharedApiModule],
  controllers: [JudgesController, RuntimesController],
  providers: [
    JudgesService,
    RuntimesService,
    JudgesRepository,
    JudgeRunsRepository,
    JudgeQueueRepository,
    JudgeQueueService,
  ],
  exports: [JudgesRepository],
})
export class JudgesApiModule {}
