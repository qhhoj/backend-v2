import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { SettingsAdminService } from './settings-admin.service';
import { SettingsController } from './settings.controller';

/** `SettingsService` comes from the global `SettingsModule`. */
@Module({
  imports: [AuthModule],
  controllers: [SettingsController],
  providers: [SettingsAdminService],
})
export class SettingsApiModule {}
