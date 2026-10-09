import { newId, toUuid } from '@libs/database';
import type { Collection, UUID } from 'mongodb';
import type { User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { TicketSummaryResponse } from '../src/modules/tickets/alerts/dto/ticket-summary.response';
import { authed } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

const SUMMARY = '/api/internal/tickets/summary';

describe('ticket summary', () => {
  let api: ApiTest;
  const people: Record<string, { id: string; session: TestSession }> = {};
  /** Raw access: the migrator's writes bypass Mongoose defaults and casts. */
  const rawTickets = () =>
    api.tickets.collection as unknown as Collection<
      Record<string, unknown> & { _id: UUID }
    >;
  const summary = async (who: string) =>
    dataOf<TicketSummaryResponse>(
      await authed(api.http().get(SUMMARY), people[who].session).expect(200),
    );
  const post = (who: string, id: string, body: string) =>
    authed(
      api.http().post(ticketUrl(id, '/messages')),
      people[who].session,
    ).send({ body });
  const patch = (who: string, id: string, body: Record<string, unknown>) =>
    authed(api.http().patch(ticketUrl(id)), people[who].session).send(body);

  beforeAll(async () => {
    api = await setupApiTest();
    const accounts: Array<[string, Partial<User>]> = [
      ['creator', {}],
      ['assignee', {}],
      ['other', {}],
      ['staff', { permissions: ['judge.change_ticket'] }],
      ['staff2', { permissions: ['judge.change_ticket'] }],
    ];
    for (const [name, extra] of accounts) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
  });
  beforeEach(() => api.tickets.deleteMany({}));
  afterAll(() => api.teardown());

  describe('assignedOpen', () => {
    it('counts the open tickets assigned to the viewer, and follows closing and unassigning', async () => {
      const mine = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
      });
      await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
        isOpen: false,
      });
      await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.other.id],
      });
      expect((await summary('assignee')).assignedOpen).toBe(1);
      expect((await summary('other')).assignedOpen).toBe(1);
      expect((await summary('creator')).assignedOpen).toBe(0);
      await patch('assignee', mine._id, { isOpen: false }).expect(200);
      expect((await summary('assignee')).assignedOpen).toBe(0);
    });
  });

  describe('awaitingStaff', () => {
    it('counts open tickets whose newest message is not from staff, and follows the conversation', async () => {
      const waiting = await createTicket(api, { creator: people.creator.id });
      await createTicket(api, {
        creator: people.creator.id,
        lastMessageByStaff: true,
      });
      await createTicket(api, { creator: people.creator.id, isOpen: false });
      expect((await summary('staff')).awaitingStaff).toBe(1);
      await post('staff', waiting._id, 'on it').expect(201);
      expect((await summary('staff')).awaitingStaff).toBe(0);
      await post('creator', waiting._id, 'thanks, but').expect(201);
      expect((await summary('staff')).awaitingStaff).toBe(1);
      expect((await summary('staff2')).awaitingStaff).toBe(1);
    });

    it('is 0 for everybody who does not hold change_ticket', async () => {
      await createTicket(api, { creator: people.creator.id });
      for (const who of ['creator', 'assignee', 'other'])
        expect((await summary(who)).awaitingStaff).toBe(0);
    });

    it('counts a ticket without the flag (migrated or predating B2) as waiting until its next message', async () => {
      // The migrator writes with a raw bulkWrite, so no default is applied: the field is absent.
      const legacyId = newId();
      await rawTickets().insertOne({
        _id: toUuid(legacyId),
        title: 'Migrated',
        user: toUuid(people.creator.id),
        assignees: [],
        linkedItem: { type: 'general', id: toUuid(people.creator.id) },
        isOpen: true,
        messages: [],
        messageCount: 0,
        lastMessageAt: new Date(),
      });
      expect(
        await rawTickets().findOne({ _id: toUuid(legacyId) }),
      ).not.toHaveProperty('lastMessageByStaff');
      expect((await summary('staff')).awaitingStaff).toBe(1);
      await post('staff', legacyId, 'sorry for the wait').expect(201);
      expect((await summary('staff')).awaitingStaff).toBe(0);
    });
  });

  describe('the stored flag', () => {
    it('is set from the author of every message', async () => {
      const ticket = await createTicket(api, { creator: people.creator.id });
      const flag = async () =>
        (await api.tickets.findById(ticket._id).lean())?.lastMessageByStaff;
      await post('staff', ticket._id, 'a').expect(201);
      expect(await flag()).toBe(true);
      await post('creator', ticket._id, 'b').expect(201);
      expect(await flag()).toBe(false);
    });

    it('starts true for a ticket filed by staff, false for anybody else', async () => {
      const file = (who: string) =>
        authed(
          api.http().post('/api/internal/tickets/general'),
          people[who].session,
        ).send({
          title: 'Help',
          body: 'please',
          issueUrl: 'https://example.com/x',
        });
      const byStaff = dataOf<{ id: string }>(await file('staff').expect(201));
      const byUser = dataOf<{ id: string }>(await file('creator').expect(201));
      const flagOf = async (id: string) =>
        (await api.tickets.findById(id).lean())?.lastMessageByStaff;
      expect(await flagOf(byStaff.id)).toBe(true);
      expect(await flagOf(byUser.id)).toBe(false);
    });
  });

  it('is for signed-in users and cached for 15 seconds by the browser only', async () => {
    await api.http().get(SUMMARY).expect(401);
    const response = await authed(
      api.http().get(SUMMARY),
      people.staff.session,
    ).expect(200);
    expect(response.headers['cache-control']).toBe('private, max-age=15');
  });

  it('counts through the indexes, not a collection scan', async () => {
    await api.tickets.insertMany(
      Array.from({ length: 60 }, (_unused, index) => ({
        title: `closed ${index}`,
        user: people.creator.id,
        linkedItem: { type: 'general' as const, id: people.creator.id },
        isOpen: false,
        assignees: [people.assignee.id],
      })),
    );
    await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    const operations = await profileQueries(api.db, async () => {
      await summary('staff');
      await summary('assignee');
    });
    const reads = operations.filter(
      ({ collection }) => collection === 'tickets',
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads)
      expect(read.planSummary).not.toContain('COLLSCAN');
  });
});
