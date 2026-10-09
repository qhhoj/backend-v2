import { newId, uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type {
  TicketDetailResponse,
  TicketListItemResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import { TicketsRepository } from '../src/modules/tickets/core/tickets.repository';
import { authed } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('ticket timeline', () => {
  let api: ApiTest;
  const people: Record<string, { id: string; session: TestSession }> = {};
  const patch = (who: string, id: string, body: Record<string, unknown>) =>
    authed(api.http().patch(ticketUrl(id)), people[who].session).send(body);
  const detail = async (who: string, id: string) =>
    dataOf<TicketDetailResponse>(
      await authed(api.http().get(ticketUrl(id)), people[who].session).expect(
        200,
      ),
    );
  const shape = (ticket: TicketDetailResponse) =>
    ticket.timeline.map((entry) =>
      entry.kind === 'message'
        ? 'message'
        : [
            entry.event!.type,
            entry.event!.actor.username,
            entry.event!.target?.username ?? null,
          ],
    );
  const stored = (id: string) => api.tickets.findById(id).lean();

  beforeAll(async () => {
    api = await setupApiTest();
    const accounts: Array<[string, Partial<User>]> = [
      ['creator', {}],
      ['assignee', {}],
      ['other', {}],
      ['staff', { permissions: ['judge.change_ticket'] }],
    ];
    for (const [name, extra] of accounts) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
  });
  afterAll(() => api.teardown());

  it('records closing and reopening with the actor, between the messages', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    await patch('creator', ticket._id, { isOpen: false }).expect(200);
    await patch('assignee', ticket._id, { isOpen: true }).expect(200);
    expect(shape(await detail('creator', ticket._id))).toEqual([
      'message',
      ['closed', 'creator', null],
      ['reopened', 'assignee', null],
    ]);
  });

  it('adds nothing for an edit that changes nothing', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    await patch('creator', ticket._id, { isOpen: true }).expect(200);
    await patch('staff', ticket._id, { notes: 'looking' }).expect(200);
    expect((await stored(ticket._id))?.events).toHaveLength(0);
  });

  it('records marking good and unmarking, staff only', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    await patch('staff', ticket._id, { isContributive: true }).expect(200);
    await patch('staff', ticket._id, { isContributive: false }).expect(200);
    await patch('creator', ticket._id, { isContributive: true }).expect(403);
    expect(
      (await detail('staff', ticket._id)).timeline.map(
        (entry) => entry.event?.type ?? 'message',
      ),
    ).toEqual(['message', 'marked-good', 'unmarked-good']);
  });

  it('records who joined and who left an assignment, and the owner can read the names', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    await patch('staff', ticket._id, { assignees: ['other'] }).expect(200);
    expect(shape(await detail('creator', ticket._id))).toEqual([
      'message',
      ['unassigned', 'staff', 'assignee'],
      ['assigned', 'staff', 'other'],
    ]);
  });

  it('records the events of one edit in a fixed order next to the state change', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    await patch('staff', ticket._id, {
      isOpen: false,
      isContributive: true,
      assignees: ['assignee'],
    }).expect(200);
    const row = await stored(ticket._id);
    expect(row).toMatchObject({ isOpen: false, isContributive: true });
    expect(row?.events.map((event) => event.type)).toEqual([
      'closed',
      'marked-good',
      'assigned',
    ]);
  });

  it('applies an update only while the changed fields still hold what was read', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const repository = api.app.get(TicketsRepository);
    const read = { isOpen: true, isContributive: false, assignees: [] };
    const closed = {
      type: 'closed' as const,
      user: people.staff.id,
      at: new Date(),
      target: null,
    };
    expect(
      await repository.update(ticket._id, { isOpen: false }, read, [closed]),
    ).toBe(true);
    expect(
      await repository.update(ticket._id, { isOpen: false }, read, [closed]),
    ).toBe(false);
    expect((await stored(ticket._id))?.events).toHaveLength(1);
  });

  it('refuses an assignees change when the assignees changed since they were read', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.other.id],
    });
    const repository = api.app.get(TicketsRepository);
    const read = { isOpen: true, isContributive: false, assignees: [] };
    expect(
      await repository.update(
        ticket._id,
        { assignees: [people.assignee.id] },
        read,
      ),
    ).toBe(false);
    expect((await stored(ticket._id))?.assignees.map(uuidStr)).toEqual([
      people.other.id,
    ]);
    expect(
      await repository.update(
        ticket._id,
        { assignees: [people.assignee.id] },
        { ...read, assignees: [people.other.id] },
      ),
    ).toBe(true);
  });

  it('refuses a good-ticket change when the flag changed since it was read', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      isContributive: true,
    });
    const repository = api.app.get(TicketsRepository);
    const read = { isOpen: true, isContributive: false, assignees: [] };
    expect(
      await repository.update(ticket._id, { isContributive: true }, read),
    ).toBe(false);
    expect(
      await repository.update(
        ticket._id,
        { isContributive: false },
        { ...read, isContributive: true },
      ),
    ).toBe(true);
  });

  it('refuses with 409 when two staff change the assignees at once', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const repository = api.app.get(TicketsRepository);
    const original = repository.update.bind(repository);
    const racing = jest
      .spyOn(repository, 'update')
      .mockImplementationOnce(async (id, changes, read, events) => {
        await api.tickets.updateOne(
          { _id: id },
          { $set: { assignees: [people.other.id] } },
        );
        return original(id, changes, read, events);
      });
    await patch('staff', ticket._id, { assignees: ['assignee'] })
      .expect(409)
      .expect(errorCode('conflict'));
    racing.mockRestore();
    expect((await stored(ticket._id))?.assignees.map(uuidStr)).toEqual([
      people.other.id,
    ]);
  });

  it('refuses with 409 and writes nothing when the ticket changed after it was read', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const repository = api.app.get(TicketsRepository);
    const original = repository.update.bind(repository);
    const racing = jest
      .spyOn(repository, 'update')
      .mockImplementationOnce(async (id, changes, read, events) => {
        await api.tickets.updateOne({ _id: id }, { $set: { isOpen: false } });
        return original(id, changes, read, events);
      });
    await patch('creator', ticket._id, { isOpen: false })
      .expect(409)
      .expect(errorCode('conflict'));
    racing.mockRestore();
    const row = await stored(ticket._id);
    expect(row?.isOpen).toBe(false);
    expect(row?.events).toHaveLength(0);
  });

  it('keeps the newest 200 events and still changes the state when the timeline is full', async () => {
    const events = Array.from({ length: 200 }, (_unused, index) => ({
      _id: newId(),
      type: 'reopened' as const,
      user: people.staff.id,
      at: new Date(Date.UTC(2026, 0, 1, 0, index)),
      target: null,
    }));
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      events,
    });
    await patch('creator', ticket._id, { isOpen: false }).expect(200);
    const row = await stored(ticket._id);
    expect(row?.isOpen).toBe(false);
    expect(row?.events).toHaveLength(200);
    expect(row?.events[199].type).toBe('closed');
    expect(row?.events[0].at).toEqual(new Date(Date.UTC(2026, 0, 1, 0, 1)));
  });

  it('orders a message and events at the same instant by kind, then by stored order', async () => {
    const instant = new Date('2026-10-09T10:00:00.000Z');
    const first = newId();
    const second = newId();
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      messages: [
        {
          _id: newId(),
          user: people.creator.id,
          body: 'b',
          bodyHtml: '<p>b</p>',
          createdAt: instant,
        },
      ],
      events: [
        {
          _id: first,
          type: 'closed',
          user: people.staff.id,
          at: instant,
          target: null,
        },
        {
          _id: second,
          type: 'reopened',
          user: people.staff.id,
          at: instant,
          target: null,
        },
      ],
    });
    const entries = (await detail('staff', ticket._id)).timeline;
    expect(entries.map((entry) => entry.event?.id ?? 'message')).toEqual([
      'message',
      first,
      second,
    ]);
  });

  it('shows the timeline of a ticket that predates it, as its messages only', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    await api.tickets.updateOne(
      { _id: ticket._id },
      { $unset: { events: '' } },
    );
    expect(shape(await detail('creator', ticket._id))).toEqual(['message']);
  });

  it('keeps the messages field and leaves list items without a timeline', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const full = await detail('creator', ticket._id);
    expect(full.messages).toHaveLength(1);
    const list = dataOf<TicketListItemResponse[]>(
      await authed(
        api.http().get('/api/internal/tickets?own=true'),
        people.creator.session,
      ).expect(200),
    );
    for (const item of list) expect(item).not.toHaveProperty('timeline');
  });
});
