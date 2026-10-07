import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DISCORD_WEBHOOK_QUEUE } from '@libs/community';
import { DiscordWebhooksService } from './discord-webhooks.service';

@Module({
  imports: [BullModule.registerQueue({ name: DISCORD_WEBHOOK_QUEUE })],
  providers: [DiscordWebhooksService],
  exports: [DiscordWebhooksService],
})
export class DiscordModule {}
