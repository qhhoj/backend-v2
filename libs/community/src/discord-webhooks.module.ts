import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DiscordWebhooksService } from './discord-webhooks.service';
import { DISCORD_WEBHOOK_QUEUE } from './queues';

@Module({
  imports: [BullModule.registerQueue({ name: DISCORD_WEBHOOK_QUEUE })],
  providers: [DiscordWebhooksService],
  exports: [DiscordWebhooksService],
})
export class DiscordWebhooksModule {}
