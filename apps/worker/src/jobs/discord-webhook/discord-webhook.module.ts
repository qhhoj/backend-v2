import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DISCORD_WEBHOOK_QUEUE } from '@libs/community';
import { DiscordWebhookProcessor } from './discord-webhook.processor';
import { DiscordWebhookService } from './discord-webhook.service';

@Module({
  imports: [BullModule.registerQueue({ name: DISCORD_WEBHOOK_QUEUE })],
  providers: [DiscordWebhookProcessor, DiscordWebhookService],
})
export class DiscordWebhookModule {}
