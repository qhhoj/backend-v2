import { Inject, Injectable } from '@nestjs/common';
import { ENV, excerpt, InjectJob } from '@libs/common';
import type { Env, JobProducer } from '@libs/common';
import type { Problem } from '@libs/database';
import { SettingsService } from '@libs/settings';
import { discordWebhookUrl } from './discord';
import type { DiscordEvent, DiscordMessage } from './discord';
import { communityJobs } from './jobs';
import type { DiscordWebhookJob } from './jobs';

/** The fields a new-problem announcement shows. */
export type AnnouncedProblem = Pick<
  Problem,
  'code' | 'name' | 'description' | 'timeLimit' | 'memoryLimit' | 'points'
>;

/** The only door to Discord (api and worker): skips events without a URL, so an empty `discord.webhooks` setting queues nothing. */
@Injectable()
export class DiscordWebhooksService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly settings: SettingsService,
    @InjectJob(communityJobs.discordWebhook)
    private readonly webhooks: JobProducer<DiscordWebhookJob>,
  ) {}

  async notify(event: DiscordEvent, message: DiscordMessage): Promise<void> {
    if (discordWebhookUrl(this.settings.get('discord.webhooks'), event))
      await this.webhooks.enqueue({ event, message });
  }

  /** Legacy `SITE_FULL_URL + path`. */
  link(path: string): string {
    return `${this.env.siteUrl}${path}`;
  }

  author(username: string): { name: string; url: string } {
    return {
      name: username,
      url: this.link(`/user/${encodeURIComponent(username)}`),
    };
  }

  /** Legacy `on_new_problem` (organization problems, created on the site or imported) and `on_new_suggested_problem`. `username` is the creator: the suggester in suggest mode, a curator otherwise (legacy: `suggester or authors.first()`). Legacy's trailing `Organizations:` line is omitted on purpose (less exposure). */
  announceNewProblem(
    problem: AnnouncedProblem,
    mode: 'create' | 'suggest',
    username: string,
  ): Promise<void> {
    const suggested = mode === 'suggest';
    const url = this.link(`/problem/${problem.code}`);
    return this.notify(
      suggested ? 'on_new_suggested_problem' : 'on_new_problem',
      {
        title: `New ${suggested ? 'suggested' : 'organization'} problem ${url}`,
        description: [
          `Title: ${problem.name}`,
          `Statement: ${excerpt(problem.description ?? '', 100)}...\n`,
          `Time limit: ${problem.timeLimit}`,
          `Memory limit (MB): ${problem.memoryLimit / 1024}`,
          `Points: ${problem.points}`,
        ].join('\n'),
        author: this.author(username),
      },
    );
  }
}
