import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { CONTEST_RESCORE_QUEUE } from '@libs/contests';
import { ProblemsApiModule } from '../problems/problems-api.module';
import { ContestAccessModule } from './contest-access.module';
import { ContestEditingController } from './contest-editing.controller';
import { ContestEditingService } from './contest-editing.service';
import { ContestsController } from './contests.controller';
import { ContestsService } from './contests.service';

@Module({
  imports: [
    AuthModule,
    ContestAccessModule,
    ProblemsApiModule,
    BullModule.registerQueue({ name: CONTEST_RESCORE_QUEUE }),
  ],
  // Fastify matches a static segment (Task 7's `current`) before `:key`, whatever the controller order.
  controllers: [ContestEditingController, ContestsController],
  providers: [ContestsService, ContestEditingService],
})
export class ContestsApiModule {}
