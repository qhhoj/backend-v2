import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SettingsModule } from '@libs/settings';
import { BridgeCoreModule } from './bridge-core.module';
import { BridgeService } from './bridge.service';
import { CommandsService } from './dispatch/commands.service';

/** The bridge process: the judge side (`BridgeCoreModule`), the api's command stream, and start/stop/resync. */
@Module({
  imports: [BridgeCoreModule, ScheduleModule.forRoot(), SettingsModule],
  providers: [CommandsService, BridgeService],
})
export class BridgeModule {}
