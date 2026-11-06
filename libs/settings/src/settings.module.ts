import { Global, Module } from '@nestjs/common';
import { ENV, encryptionKey, SITE_TIME_ZONE } from '@libs/common';
import type { Env } from '@libs/common';
import { SETTINGS_KEY } from './settings-key';
import { SettingRevisionsRepository } from './setting-revisions.repository';
import { SettingsQuerier } from './settings.querier';
import { SettingsService } from './settings.service';

/** Imported by api, worker and bridge (needs the global `EnvModule`, `DatabaseModule` and a root `ScheduleModule`). */
@Global()
@Module({
  providers: [
    {
      provide: SETTINGS_KEY,
      inject: [ENV],
      useFactory: (env: Env) => encryptionKey(env.encryptionKey),
    },
    SettingsQuerier,
    SettingRevisionsRepository,
    SettingsService,
    {
      provide: SITE_TIME_ZONE,
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => () =>
        settings.get('site.timeZone'),
    },
  ],
  exports: [SettingsService, SITE_TIME_ZONE],
})
export class SettingsModule {}
