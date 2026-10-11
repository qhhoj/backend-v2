import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { DiscordWebhooksModule } from '@libs/community';
import { DiscordWebhooksAdminController } from './webhooks/discord-webhooks-admin.controller';
import { DiscordWebhooksAdminService } from './webhooks/discord-webhooks-admin.service';
import { SettingsAdminService } from './settings-admin.service';
import { SettingsController } from './settings.controller';

/** `SettingsService` comes from the global `SettingsModule`. */
@Module({
  imports: [AuthModule, DiscordWebhooksModule],
  controllers: [SettingsController, DiscordWebhooksAdminController],
  providers: [SettingsAdminService, DiscordWebhooksAdminService],
})
export class SettingsApiModule {}
