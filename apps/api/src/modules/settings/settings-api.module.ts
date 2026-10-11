import { Module } from '@nestjs/common';
import { AuthModule } from '@libs/auth';
import { DiscordModule } from '../discord/discord.module';
import { DiscordWebhooksAdminController } from './webhooks/discord-webhooks-admin.controller';
import { DiscordWebhooksAdminService } from './webhooks/discord-webhooks-admin.service';
import { SettingsAdminService } from './settings-admin.service';
import { SettingsController } from './settings.controller';

/** `SettingsService` comes from the global `SettingsModule`. */
@Module({
  imports: [AuthModule, DiscordModule],
  controllers: [SettingsController, DiscordWebhooksAdminController],
  providers: [SettingsAdminService, DiscordWebhooksAdminService],
})
export class SettingsApiModule {}
