import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { DISCORD_WEBHOOK_JOB, DISCORD_WEBHOOK_QUEUE } from '@libs/community';
import type { DiscordWebhookJob } from '@libs/community';
import { DiscordWebhookService } from '../src/jobs/discord-webhook/discord-webhook.service';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('discord webhook job', () => {
  let worker: WorkerTest;
  let server: Server;
  let base: string;
  let status = 204;
  const received: Array<{ path: string; body: unknown }> = [];
  const job: DiscordWebhookJob = {
    event: 'on_new_comment',
    message: {
      title: 'New comment http://site/problem/a#comment-1',
      description: 'Hello',
      author: { name: 'alice', url: 'http://site/user/alice' },
    },
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk: Buffer) => (body += chunk.toString()));
      request.on('end', () => {
        received.push({ path: request.url ?? '', body: JSON.parse(body) });
        response.statusCode = status;
        response.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    worker = await setupWorkerTest({
      env: {
        DISCORD_WEBHOOK_URLS: `default=${base}/default,on_new_blogpost=${base}/blog`,
      },
    });
  });
  beforeEach(() => {
    received.splice(0);
    status = 204;
  });
  afterAll(async () => {
    await worker.module
      .get<Queue<DiscordWebhookJob>>(getQueueToken(DISCORD_WEBHOOK_QUEUE))
      .obliterate({ force: true });
    await worker.teardown();
    await new Promise((resolve) => server.close(resolve));
  });

  it('posts the embed to the URL configured for the event, else the default', async () => {
    const service = worker.module.get(DiscordWebhookService);
    await expect(service.send(job)).resolves.toBe(true);
    await service.send({ ...job, event: 'on_new_blogpost' });
    expect(received).toEqual([
      {
        path: '/default',
        body: {
          embeds: [
            {
              title: job.message.title,
              description: 'Hello',
              color: 0x03b2f8,
              author: job.message.author,
            },
          ],
        },
      },
      expect.objectContaining({ path: '/blog' }),
    ]);
  });

  it('throws on a refused post without naming the URL, so BullMQ retries', async () => {
    status = 500;
    const service = worker.module.get(DiscordWebhookService);
    const failure = service.send(job);
    await expect(failure).rejects.toThrow(/500/);
    await expect(failure).rejects.not.toThrow(new RegExp(base));
  });

  it('sends queued jobs', async () => {
    const queue = worker.module.get<Queue<DiscordWebhookJob>>(
      getQueueToken(DISCORD_WEBHOOK_QUEUE),
    );
    await queue.add(DISCORD_WEBHOOK_JOB, job);
    await waitUntil(() => received.length === 1);
    expect(received[0].path).toBe('/default');
  });
});
