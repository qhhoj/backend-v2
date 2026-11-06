import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { communityJobs } from '@libs/community';
import { DiscordWebhookProcessor } from './discord-webhook.processor';
import { DiscordWebhookService } from './discord-webhook.service';

@Module({
  imports: [JobsModule.register(communityJobs.discordWebhook)],
  providers: [DiscordWebhookProcessor, DiscordWebhookService],
})
export class DiscordWebhookModule {}
