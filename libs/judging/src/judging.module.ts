import { Module } from '@nestjs/common';
import { BridgeCommandsService } from './bridge-commands.service';
import { SubmissionEventsService } from './submission-events.service';

/** For api modules that talk to the bridge; `REDIS` comes from the app's global `RedisModule`. */
@Module({
  providers: [BridgeCommandsService, SubmissionEventsService],
  exports: [BridgeCommandsService, SubmissionEventsService],
})
export class JudgingModule {}
