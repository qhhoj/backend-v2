import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { DISCORD_WEBHOOK_QUEUE } from '@libs/community';
import type { DiscordWebhookJob } from '@libs/community';
import { createOrganization } from './organization-fixtures';
import {
  authed,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('problem webhooks', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let queue: Queue<DiscordWebhookJob>;
  let admin: TestSession;
  let suggester: TestSession;
  const queued = async () =>
    (await queue.getJobs(['waiting', 'delayed'])).map((job) => job.data);
  const problem = (code: string, extra: object = {}) => ({
    code,
    name: code.toUpperCase(),
    description: 'Statement text',
    timeLimit: 1,
    memoryLimit: 262144,
    points: 1000,
    typeIds: [catalog.types.dp],
    groupId: catalog.groups.voi,
    ...extra,
  });

  beforeAll(async () => {
    api = await setupApiTest({
      env: { DISCORD_WEBHOOK_URLS: 'default=http://127.0.0.1:9/secret-hook' },
    });
    catalog = await seedCatalog(api);
    queue = api.app.get(getQueueToken(DISCORD_WEBHOOK_QUEUE));
    admin = await loginAs(
      api,
      (await createUserWith(api, 'root', { isSuperuser: true }))._id,
    );
    suggester = await loginAs(
      api,
      (
        await createUserWith(api, 'idea', {
          permissions: ['judge.suggest_new_problem', 'judge.edit_own_problem'],
        })
      )._id,
    );
  });
  beforeEach(() => queue.drain());
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await api.teardown();
  });

  it('announces organization and suggested problems only, without the URL', async () => {
    const organization = await createOrganization(api);
    await authed(api.http().post('/api/internal/problems'), admin)
      .send(problem('public_one'))
      .expect(201);
    await authed(api.http().post('/api/internal/problems'), admin)
      .send(
        problem('org_one', {
          isOrganizationPrivate: true,
          organizations: [organization._id],
        }),
      )
      .expect(201);
    await authed(api.http().post('/api/internal/problems/suggest'), suggester)
      .send(problem('idea_one'))
      .expect(201);
    const jobs = await queued();
    expect(jobs.map((job) => job.event).sort()).toEqual([
      'on_new_problem',
      'on_new_suggested_problem',
    ]);
    expect(jobs.find((job) => job.event === 'on_new_problem')).toMatchObject({
      message: {
        title: 'New organization problem http://localhost:5173/problem/org_one',
        author: { name: 'root' },
      },
    });
    expect(JSON.stringify(jobs)).not.toContain('secret-hook');
  });
});
