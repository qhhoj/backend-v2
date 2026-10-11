import { waitUntil } from '@libs/common/testing';
import type { User } from '@libs/database';
import {
  DEFAULT_STREAM_LIMITS,
  STREAM_LIMITS,
} from '../src/modules/events/stream-limits';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { openStream, streamsOf } from './sse-client';
import type { SseClient } from './sse-client';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { TicketsRepository } from '../src/modules/tickets/core/tickets.repository';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('ticket streams', () => {
  let api: ApiTest;
  let streams: ReturnType<typeof streamsOf>;
  let problemId: string;
  let catalog: Awaited<ReturnType<typeof seedCatalog>>;
  const people: Record<string, { id: string; session: TestSession }> = {};
  const opened: SseClient[] = [];
  const open = async (path: string, who: string | null) => {
    const client = await openStream(
      api,
      path,
      who ? { Cookie: people[who].session.cookie } : {},
    );
    opened.push(client);
    return client;
  };
  const feed = (who: string) => open('/api/internal/events/tickets', who);
  const framesOf = (client: SseClient, event: string) =>
    client.messages.filter((message) => message.event === event);
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 250));
  const post = (who: string, ticketId: string, body: string) =>
    authed(
      api.http().post(ticketUrl(ticketId, '/messages')),
      people[who].session,
    ).send({ body });

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [
        {
          provide: STREAM_LIMITS,
          useValue: {
            ...DEFAULT_STREAM_LIMITS,
            heartbeatMs: 100,
            recheckMs: 150,
            ticketBacklog: 3,
          },
        },
      ],
    });
    streams = streamsOf(api);
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['creator', {}],
      ['assignee', {}],
      ['staff', { permissions: ['judge.change_ticket'] }],
      ['author', { permissions: ['judge.edit_own_problem'] }],
      [
        'publicEditor',
        {
          permissions: ['judge.edit_own_problem', 'judge.edit_public_problem'],
        },
      ],
      ['outsider', {}],
    ];
    for (const [name, extra] of roles) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
    problemId = (
      await createProblem(api, catalog, {
        code: 'sum_two',
        authors: [people.author.id],
      })
    )._id;
    await createProblem(api, catalog, {
      code: 'secret_one',
      isPublic: false,
      authors: [people.author.id],
    });
  });
  afterEach(async () => {
    for (const client of opened.splice(0)) client.close();
    await waitUntil(() => streams.openCounts().total === 0);
  });
  afterAll(() => api.teardown());

  it('refuses signed-out visitors, unknown tickets and tickets the viewer may not read', async () => {
    expect((await open('/api/internal/events/tickets', null)).status).toBe(401);
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      problem: problemId,
    });
    expect(
      (await open(`/api/internal/events/tickets/${ticket._id}`, 'outsider'))
        .status,
    ).toBe(403);
    expect(
      (await open('/api/internal/events/tickets/not-a-uuid', 'creator')).status,
    ).toBe(404);
    expect(
      (await open(`/api/internal/events/tickets/${ticket._id}`, 'creator'))
        .status,
    ).toBe(200);
  });

  it('delivers ticket events only to viewers who can access the ticket', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
      problem: problemId,
    });
    const readers = ['creator', 'assignee', 'staff', 'author', 'publicEditor'];
    const feeds: Record<string, SseClient> = Object.fromEntries(
      await Promise.all(
        [...readers, 'outsider'].map(
          async (who): Promise<[string, SseClient]> => [who, await feed(who)],
        ),
      ),
    );
    const single = await open(
      `/api/internal/events/tickets/${ticket._id}`,
      'creator',
    );
    const other = await createTicket(api, { creator: people.outsider.id });
    const otherStream = await open(
      `/api/internal/events/tickets/${other._id}`,
      'outsider',
    );

    const message = await post('creator', ticket._id, 'ping').expect(201);
    const messageId = (message.body as { data: { id: string } }).data.id;
    for (const who of readers) {
      const frame = await feeds[who].next('ticket-message');
      expect(frame.data).toEqual({
        ticketId: ticket._id,
        messageId,
        open: null,
      });
    }
    expect((await single.next('ticket-message')).data).toMatchObject({
      ticketId: ticket._id,
    });
    await quiet();
    expect(framesOf(feeds.outsider, 'ticket-message')).toEqual([]);
    expect(framesOf(otherStream, 'ticket-message')).toEqual([]);
  });

  it('stops delivering when access is revoked', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    const assigneeFeed = await feed('assignee');
    const assigneeTicket = await open(
      `/api/internal/events/tickets/${ticket._id}`,
      'assignee',
    );
    const creatorFeed = await feed('creator');
    await authed(api.http().patch(ticketUrl(ticket._id)), people.staff.session)
      .send({ assignees: [] })
      .expect(200);
    await post('creator', ticket._id, 'after removal').expect(201);
    await creatorFeed.next('ticket-message');
    await quiet();
    expect(framesOf(assigneeFeed, 'ticket-message')).toEqual([]);
    await Promise.race([
      assigneeTicket.closed,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('stream stayed open')), 2000),
      ),
    ]);
  });

  it('stops delivering to staff who lose the permission, once the stream is rechecked', async () => {
    const { user, session } = await signedIn(api, 'demoted', {
      permissions: ['judge.change_ticket'],
    });
    people.demoted = { id: user._id, session };
    const ticket = await createTicket(api, { creator: people.creator.id });
    const demoted = await feed('demoted');
    const creatorFeed = await feed('creator');
    await post('creator', ticket._id, 'first').expect(201);
    await demoted.next('ticket-message');
    await creatorFeed.next('ticket-message');
    await api.users.updateOne({ _id: user._id }, { $set: { permissions: [] } });
    await quiet();
    await post('creator', ticket._id, 'second').expect(201);
    await creatorFeed.next('ticket-message');
    await quiet();
    expect(framesOf(demoted, 'ticket-message')).toEqual([]);
  });

  it('drops events beyond the backlog and tells the streams to resync once it drains', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const watcher = await feed('creator');
    const repository = api.app.get(TicketsRepository);
    const findById = repository.findById.bind(repository);
    const slow = jest
      .spyOn(repository, 'findById')
      .mockImplementation(async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return findById(...args);
      });
    try {
      await Promise.all(
        Array.from({ length: 6 }, (_unused, count) =>
          post('creator', ticket._id, `burst ${count}`).expect(201),
        ),
      );
      await watcher.next('resync');
      await quiet();
    } finally {
      slow.mockRestore();
    }
    expect(framesOf(watcher, 'ticket-message').length).toBeLessThan(6);
    // the first resync was consumed by next(); no second one follows
    expect(framesOf(watcher, 'resync')).toEqual([]);
  });
});
