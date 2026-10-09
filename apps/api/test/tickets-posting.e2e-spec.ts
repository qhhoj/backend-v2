import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import { DISCORD_WEBHOOK_QUEUE, TICKET_EVENTS_CHANNEL } from '@libs/community';
import type { DiscordWebhookJob, TicketEvent } from '@libs/community';
import { newId } from '@libs/database';
import type {
  TicketDetailResponse,
  TicketMessageResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import {
  clearRateLimits,
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('filing tickets and posting messages', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let queue: Queue<DiscordWebhookJob>;
  let subscriber: Redis;
  const events: TicketEvent[] = [];
  const people: Record<string, { id: string; session: TestSession }> = {};
  const post = (who: string, path: string, body: Record<string, unknown>) =>
    authed(api.http().post(path), people[who].session).send(body);
  const fileFor = (
    who: string,
    code: string,
    body: Record<string, unknown> = {
      title: 'Wrong answer',
      body: 'Sample 2 looks wrong',
    },
  ) => post(who, `/api/internal/problems/${code}/tickets`, body);
  const queued = async () =>
    (await queue.getJobs(['waiting', 'delayed'])).map((job) => job.data);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    await api.setSetting('discord.webhooks', {
      default: 'http://127.0.0.1:9/secret-hook',
    });
    queue = api.app.get(getQueueToken(DISCORD_WEBHOOK_QUEUE));
    subscriber = api.app.get<Redis>(REDIS).duplicate();
    await subscriber.subscribe(TICKET_EVENTS_CHANNEL);
    subscriber.on('message', (_channel, raw) =>
      events.push(JSON.parse(raw) as TicketEvent),
    );
    for (const [name, extra] of [
      ['filer', {}],
      ['author', {}],
      ['contestAuthor', {}],
      ['muted', { mute: true }],
      ['outsider', {}],
      ['assignee', {}],
    ] as const) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
    await createProblem(api, catalog, {
      code: 'sum_two',
      authors: [people.author.id],
    });
    await createProblem(api, catalog, {
      code: 'secret_one',
      isPublic: false,
      authors: [people.author.id],
    });
  });
  beforeEach(async () => {
    await queue.drain();
    await clearRateLimits(api);
    events.length = 0;
  });
  afterAll(async () => {
    await subscriber.quit();
    await queue.obliterate({ force: true });
    await api.teardown();
  });

  it('files a problem ticket assigned to the problem authors, rendered in the user style', async () => {
    const response = await fileFor('filer', 'sum_two', {
      title: 'Wrong answer',
      body: 'Hi <script>alert(1)</script> **bold**',
    }).expect(201);
    const ticket = dataOf<TicketDetailResponse>(response);
    expect(ticket).toMatchObject({
      title: 'Wrong answer',
      creator: { username: 'filer' },
      assignees: [{ username: 'author' }],
      link: { type: 'problem', key: 'sum_two', url: '/problem/sum_two' },
      isOpen: true,
      messageCount: 1,
    });
    expect(ticket.messages[0].bodyHtml).toContain('<strong>bold</strong>');
    expect(ticket.messages[0].bodyHtml).not.toContain('<script>');
    expect(await api.tickets.countDocuments({ _id: ticket.id })).toBe(1);
  });

  it('assigns the contest authors when the problem is filed from a contest that has it', async () => {
    const problem = (await api.problems.findOne({ code: 'sum_two' }))!;
    const contest = await createContest(api, {
      authors: [people.contestAuthor.id],
      problems: [contestProblem(problem._id, 1)],
    });
    const participation = await joinParticipation(
      api,
      contest._id,
      people.filer.id,
    );
    await makeCurrent(api, people.filer.id, participation._id);
    const inContest = dataOf<TicketDetailResponse>(
      await fileFor('filer', 'sum_two').expect(201),
    );
    expect(inContest.assignees.map((assignee) => assignee.username)).toEqual([
      'contestAuthor',
    ]);
    await makeCurrent(api, people.filer.id, null);
    const outside = dataOf<TicketDetailResponse>(
      await fileFor('filer', 'sum_two').expect(201),
    );
    expect(outside.assignees.map((assignee) => assignee.username)).toEqual([
      'author',
    ]);
  });

  it('files a general ticket with an http(s) issue url only', async () => {
    const general = (issueUrl: string) =>
      post('filer', '/api/internal/tickets/general', {
        title: 'Site bug',
        body: 'The page is blank',
        issueUrl,
      });
    const ticket = dataOf<TicketDetailResponse>(
      await general('https://example.com/page').expect(201),
    );
    expect(ticket).toMatchObject({
      assignees: [],
      link: { type: 'general', url: 'https://example.com/page' },
    });
    expect(
      await api.generalIssues.countDocuments({
        issueUrl: 'https://example.com/page',
      }),
    ).toBe(1);
    for (const bad of [
      'javascript:alert(1)',
      'ftp://example.com/x',
      'not a url',
      `https://example.com/${'a'.repeat(200)}`,
    ])
      await general(bad).expect(400).expect(errorCode('validation_failed'));
    expect(await api.generalIssues.countDocuments()).toBe(1);
  });

  it('trims the issue url and refuses credentials in it', async () => {
    const general = (issueUrl: string) =>
      post('filer', '/api/internal/tickets/general', {
        title: 'Site bug',
        body: 'blank',
        issueUrl,
      });
    const ticket = dataOf<TicketDetailResponse>(
      await general('  https://example.com/padded  ').expect(201),
    );
    expect(ticket.link.url).toBe('https://example.com/padded');
    await general('https://user:pass@example.com/x')
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('files on a private problem only while its contest is current, and not before it starts', async () => {
    const secret = (await api.problems.findOne({ code: 'secret_one' }))!;
    const contest = await createContest(api, {
      authors: [people.contestAuthor.id],
      problems: [contestProblem(secret._id, 1)],
    });
    const participation = await joinParticipation(
      api,
      contest._id,
      people.filer.id,
    );
    await makeCurrent(api, people.filer.id, participation._id);
    const inside = dataOf<TicketDetailResponse>(
      await fileFor('filer', 'secret_one').expect(201),
    );
    expect(inside.assignees.map((assignee) => assignee.username)).toEqual([
      'contestAuthor',
    ]);
    await makeCurrent(api, people.filer.id, null);
    await fileFor('filer', 'secret_one').expect(404);
    const upcoming = await createContest(api, {
      startTime: new Date(Date.now() + 3_600_000),
      endTime: new Date(Date.now() + 7_200_000),
      problems: [contestProblem(secret._id, 1)],
    });
    await makeCurrent(
      api,
      people.filer.id,
      (await joinParticipation(api, upcoming._id, people.filer.id))._id,
    );
    await fileFor('filer', 'secret_one').expect(404);
    await makeCurrent(api, people.filer.id, null);
  });

  it('refuses unknown or invisible problems, muted users and signed-out visitors', async () => {
    await fileFor('outsider', 'secret_one').expect(404);
    await fileFor('outsider', 'nope').expect(404);
    await fileFor('author', 'secret_one').expect(201);
    await fileFor('muted', 'sum_two')
      .expect(403)
      .expect(errorCode('forbidden'));
    await api
      .http()
      .post('/api/internal/problems/sum_two/tickets')
      .send({ title: 'x', body: 'y' })
      .expect(401);
    await fileFor('filer', 'sum_two', { title: '   ', body: 'y' }).expect(400);
    await fileFor('filer', 'sum_two', { title: 'x', body: '' }).expect(400);
    await fileFor('filer', 'sum_two', { title: 'x'.repeat(101), body: 'y' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await fileFor('filer', 'sum_two', { title: 'x', body: 'y'.repeat(8193) })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('limits ticket creation and messages per user', async () => {
    for (let count = 0; count < 5; count += 1)
      await fileFor('outsider', 'sum_two').expect(201);
    await fileFor('outsider', 'sum_two')
      .expect(429)
      .expect(errorCode('rate_limited'));
    await fileFor('filer', 'sum_two').expect(201);
    const ticket = await createTicket(api, { creator: people.filer.id });
    for (let count = 0; count < 30; count += 1)
      await post('filer', ticketUrl(ticket._id, '/messages'), {
        body: `m${count}`,
      }).expect(201);
    await post('filer', ticketUrl(ticket._id, '/messages'), {
      body: 'one too many',
    }).expect(429);
  });

  it('announces a new ticket and a reply on Discord without the webhook url', async () => {
    const ticket = dataOf<TicketDetailResponse>(
      await fileFor('filer', 'sum_two', {
        title: 'Hello',
        body: 'x'.repeat(300),
      }).expect(201),
    );
    await post('author', ticketUrl(ticket.id, '/messages'), {
      body: 'We will look',
    }).expect(201);
    const jobs = await queued();
    expect(jobs).toHaveLength(2);
    const created = jobs.find((job) => job.event === 'on_new_ticket')!;
    expect(created.message.title).toMatch(
      /^New ticket on https?:\/\/.+\/problem\/sum_two$/,
    );
    expect(created.message.description).toContain(`Title: [Hello](`);
    expect(created.message.description).toContain(
      `/ticket/${ticket.id})\nMessage: `,
    );
    expect(Array.from(created.message.description.split('\n')[1])).toHaveLength(
      100,
    );
    expect(created.message.author?.name).toBe('filer');
    const reply = jobs.find((job) => job.event === 'on_new_ticket_message')!;
    expect(reply.message.title).toMatch(
      new RegExp(`^New ticket reply on https?://.+/ticket/${ticket.id}$`),
    );
    expect(reply.message.description).toBe('Message: We will look');
    expect(JSON.stringify(jobs)).not.toContain('secret-hook');
  });

  it('publishes ids-only events on ticket-events', async () => {
    const ticket = dataOf<TicketDetailResponse>(
      await fileFor('filer', 'sum_two').expect(201),
    );
    const message = dataOf<TicketMessageResponse>(
      await post('author', ticketUrl(ticket.id, '/messages'), {
        body: 'reply',
      }).expect(201),
    );
    const ofTicket = () =>
      events.filter((event) => event.ticketId === ticket.id);
    await waitUntil(() => ofTicket().length === 2);
    expect(ofTicket()).toEqual([
      {
        type: 'new-ticket',
        ticketId: ticket.id,
        messageId: ticket.messages[0].id,
        open: null,
      },
      {
        type: 'ticket-message',
        ticketId: ticket.id,
        messageId: message.id,
        open: null,
      },
    ]);
  });

  it('lets the creator, an assignee and a problem editor post, even on a closed ticket, and nobody else', async () => {
    const ticket = await createTicket(api, {
      creator: people.filer.id,
      assignees: [people.assignee.id],
      isOpen: false,
    });
    const message = dataOf<TicketMessageResponse>(
      await post('filer', ticketUrl(ticket._id, '/messages'), {
        body: 'still broken',
      }).expect(201),
    );
    expect(message.author.username).toBe('filer');
    expect(message.bodyHtml).toContain('still broken');
    await post('assignee', ticketUrl(ticket._id, '/messages'), {
      body: 'ack',
    }).expect(201);
    await post('outsider', ticketUrl(ticket._id, '/messages'), {
      body: 'hi',
    }).expect(403);
    await post('filer', ticketUrl(newId(), '/messages'), { body: 'hi' }).expect(
      404,
    );
    await post('filer', ticketUrl(ticket._id, '/messages'), {
      body: ' ',
    }).expect(400);
    const stored = (await api.tickets.findById(ticket._id))!;
    expect(stored).toMatchObject({ messageCount: 3 });
    expect(stored.messages).toHaveLength(3);
    const muted = await createTicket(api, { creator: people.muted.id });
    await post('muted', ticketUrl(muted._id, '/messages'), {
      body: 'hi',
    }).expect(403);
  });

  it('tells a muted reply (issue code muted) from a lost-access reply (issue code forbidden)', async () => {
    const lost = await createTicket(api, { creator: people.filer.id });
    interface Refusal {
      error: { code: string; issues?: Array<{ field: string; code: string }> };
    }
    const mutedReply = await post('muted', ticketUrl(lost._id, '/messages'), {
      body: 'hi',
    }).expect(403);
    expect((mutedReply.body as Refusal).error).toMatchObject({
      code: 'forbidden',
      issues: [{ field: '', code: 'muted' }],
    });
    const lostReply = await post('outsider', ticketUrl(lost._id, '/messages'), {
      body: 'hi',
    }).expect(403);
    expect((lostReply.body as Refusal).error.code).toBe('forbidden');
    expect((lostReply.body as Refusal).error.issues).toEqual([
      expect.objectContaining({ field: '', code: 'forbidden' }),
    ]);
  });

  it('keeps at most 500 messages under parallel posts', async () => {
    const filler = Array.from({ length: 498 }, () => ({
      _id: newId(),
      user: people.filer.id,
      body: 'x',
      bodyHtml: '<p>x</p>',
      createdAt: new Date(),
    }));
    const ticket = await createTicket(api, {
      creator: people.filer.id,
      messages: filler,
      messageCount: 498,
    });
    const statuses = (
      await Promise.all(
        [0, 1, 2, 3, 4].map((index) =>
          post('filer', ticketUrl(ticket._id, '/messages'), {
            body: `race ${index}`,
          }),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(2);
    expect(statuses.filter((status) => status === 409)).toHaveLength(3);
    const stored = (await api.tickets.findById(ticket._id))!;
    expect(stored.messages).toHaveLength(500);
    expect(stored.messageCount).toBe(500);
    await post('filer', ticketUrl(ticket._id, '/messages'), { body: 'over' })
      .expect(409)
      .expect(errorCode('conflict'));
  });

  it('spends message budget only on posts that are written', async () => {
    const readable = await createTicket(api, { creator: people.filer.id });
    const unreadable = await createTicket(api, { creator: people.author.id });
    for (let count = 0; count < 31; count += 1)
      await post('filer', ticketUrl(unreadable._id, '/messages'), {
        body: 'no',
      }).expect(403);
    const full = Array.from({ length: 500 }, () => ({
      _id: newId(),
      user: people.filer.id,
      body: 'x',
      bodyHtml: '<p>x</p>',
      createdAt: new Date(),
    }));
    const capped = await createTicket(api, {
      creator: people.filer.id,
      messages: full,
      messageCount: 500,
    });
    for (let count = 0; count < 31; count += 1)
      await post('filer', ticketUrl(capped._id, '/messages'), {
        body: 'no',
      }).expect(409);
    await post('filer', ticketUrl(readable._id, '/messages'), {
      body: 'yes',
    }).expect(201);
  });
});
