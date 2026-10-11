import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ExternalJudgeApiModule } from '@libs/judging';
import { SettingsModule } from '@libs/settings';
import { BridgeCoreModule } from './bridge-core.module';
import { BridgeService } from './bridge.service';
import { CommandsService } from './dispatch/commands.service';
import { ExternalRunnerService } from './external/external-runner.service';
import { ExternalRunsRepository } from './external/external-runs.repository';

/** The bridge process: the judge side (`BridgeCoreModule`), the external judge adapter, the api's command stream, and start/stop/resync. */
@Module({
  imports: [
    BridgeCoreModule,
    ScheduleModule.forRoot(),
    SettingsModule,
    ExternalJudgeApiModule,
  ],
  providers: [
    ExternalRunsRepository,
    ExternalRunnerService,
    CommandsService,
    BridgeService,
  ],
})
export class BridgeModule {}
