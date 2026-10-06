import { Module } from '@nestjs/common';
import { BridgeCommandsService } from './bridge-commands.service';

/** For api modules that talk to the bridge; `REDIS` comes from the app's global `RedisModule`. */
@Module({
  providers: [BridgeCommandsService],
  exports: [BridgeCommandsService],
})
export class JudgingModule {}
