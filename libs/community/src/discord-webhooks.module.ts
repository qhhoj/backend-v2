import { Module } from '@nestjs/common';
import { JobsModule } from '@libs/common';
import { DiscordWebhooksService } from './discord-webhooks.service';
import { communityJobs } from './jobs';

@Module({
  imports: [JobsModule.register(communityJobs.discordWebhook)],
  providers: [DiscordWebhooksService],
  exports: [DiscordWebhooksService],
})
export class DiscordWebhooksModule {}
