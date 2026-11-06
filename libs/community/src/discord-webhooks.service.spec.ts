import type { Env, JobProducer } from '@libs/common';
import type { DiscordWebhookJob } from './jobs';
import type { SettingsService } from '@libs/settings';
import { fakeSettings } from '@libs/settings/testing';
import { DiscordWebhooksService } from './discord-webhooks.service';

describe('DiscordWebhooksService', () => {
  const message = { title: 'T', description: 'D', author: null };
  const serviceWith = (urls: Record<string, string>) => {
    const added: unknown[] = [];
    const webhooks = {
      enqueue: (...args: unknown[]) => (
        added.push(args),
        Promise.resolve(true)
      ),
    } as unknown as JobProducer<DiscordWebhookJob>;
    const env = { siteUrl: 'https://oj.example' } as unknown as Env;
    const settings = fakeSettings({ 'discord.webhooks': urls });
    return {
      service: new DiscordWebhooksService(
        env,
        settings as unknown as SettingsService,
        webhooks,
      ),
      added,
    };
  };

  it('enqueues nothing when no URL serves the event', async () => {
    const { service, added } = serviceWith({ on_new_blogpost: 'https://d/b' });
    await service.notify('on_new_comment', message);
    expect(added).toEqual([]);
  });

  it('enqueues the event and message, never the URL', async () => {
    const { service, added } = serviceWith({ default: 'https://d/secret' });
    await service.notify('on_new_comment', message);
    expect(added).toHaveLength(1);
    expect(JSON.stringify(added)).not.toContain('secret');
  });
});
