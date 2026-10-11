import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type { TicketDetailResponse } from '../src/modules/tickets/core/dto/ticket.response';
import { TicketsRepository } from '../src/modules/tickets/core/tickets.repository';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';
import { NotificationsRepository } from '@libs/community';
import { profileQueries } from '@libs/database/testing';
import { clearRateLimits } from './contest-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from ticket-timeline.e2e-spec.ts
{
  describe('ticket timeline', () => {
    beforeAll(() => api.reset());
    const people: Record<string, { id: string; session: TestSession }> = {};
    const patch = (who: string, id: string, body: Record<string, unknown>) =>
      authed(api.http().patch(ticketUrl(id)), people[who].session).send(body);
    const stored = (id: string) => api.tickets.findById(id).lean();

    beforeAll(async () => {
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
  });
}

// from ticket-notifications.e2e-spec.ts
{
  describe('ticket alerts', () => {
    beforeAll(() => api.reset());
    let problemCode: string;
    const people: Record<string, { id: string; session: TestSession }> = {};
    const as = (who: string) => people[who].session;
    const rowsOf = (who: string) =>
      api.notifications.find({ user: people[who].id }).sort({ _id: 1 }).lean();
    const groupOf = (ticketId: string) => `ticket:${ticketId}`;
    const post = (who: string, ticketId: string, body: string) =>
      authed(api.http().post(ticketUrl(ticketId, '/messages')), as(who)).send({
        body,
      });
    const patch = (
      who: string,
      ticketId: string,
      body: Record<string, unknown>,
    ) => authed(api.http().patch(ticketUrl(ticketId)), as(who)).send(body);

    beforeAll(async () => {
      const catalog = await seedCatalog(api);
      const accounts: Array<[string, Partial<User>]> = [
        ['creator', {}],
        ['assignee', {}],
        ['newcomer', {}],
        ['staff', { permissions: ['judge.change_ticket'] }],
        ['staff2', { permissions: ['judge.change_ticket'] }],
        [
          'inactiveStaff',
          { permissions: ['judge.change_ticket'], isActive: false },
        ],
        ['root', { isSuperuser: true }],
      ];
      for (const [name, extra] of accounts) {
        const { user, session } = await signedIn(api, name, extra);
        people[name] = { id: user._id, session };
      }
      const groupStaff = await api.groups.create({
        name: 'Ticket staff',
        permissions: ['judge.change_ticket'],
      });
      const { user: viaGroup, session } = await signedIn(api, 'groupStaff', {
        groups: [groupStaff._id],
      });
      people.groupStaff = { id: viaGroup._id, session };
      const problem = await createProblem(api, catalog, {
        code: 'sum_two',
        authors: [people.assignee.id],
      });
      problemCode = problem.code;
    });
    beforeEach(async () => {
      await api.notifications.deleteMany({});
      await api.tickets.deleteMany({});
      await clearRateLimits(api);
    });

    describe('a new ticket', () => {
      it('alerts the assignees of a problem ticket and not the filer', async () => {
        const response = await authed(
          api.http().post(`/api/internal/problems/${problemCode}/tickets`),
          as('creator'),
        )
          .send({ title: 'Lỗi chấm', body: 'Bài không chạy' })
          .expect(201);
        const ticketId = dataOf<TicketDetailResponse>(response).id;
        const [row] = await rowsOf('assignee');
        expect(row).toMatchObject({
          kind: 'ticket-new',
          priority: 'normal',
          unread: true,
          path: `/tickets/${ticketId}`,
          groupKey: groupOf(ticketId),
        });
        expect(row.title).toContain('Lỗi chấm');
        expect(await rowsOf('creator')).toHaveLength(0);
        expect(await rowsOf('staff')).toHaveLength(0);
      });

      it('alerts change_ticket holders of a general ticket, directly or through a group, but not superusers, inactive users or the filer', async () => {
        await authed(
          api.http().post('/api/internal/tickets/general'),
          as('creator'),
        )
          .send({
            title: 'Góp ý',
            body: 'Trang chậm',
            issueUrl: 'https://example.com/x',
          })
          .expect(201);
        for (const who of ['staff', 'staff2', 'groupStaff'])
          expect(await rowsOf(who)).toHaveLength(1);
        for (const who of ['root', 'inactiveStaff', 'creator', 'assignee'])
          expect(await rowsOf(who)).toHaveLength(0);
      });

      it('finds the staff through the permission and group indexes', async () => {
        await api.users.insertMany(
          Array.from({ length: 300 }, (_unused, index) => ({
            username: `bulk${index}`,
            password: 'x',
            isActive: true,
          })),
        );
        const operations = await profileQueries(api.db, () =>
          authed(
            api.http().post('/api/internal/tickets/general'),
            as('creator'),
          )
            .send({
              title: 'Idx',
              body: 'x',
              issueUrl: 'https://example.com/z',
            })
            .expect(201),
        );
        const reads = operations.filter(
          ({ collection, operation }) =>
            collection === 'users' && operation === 'query',
        );
        expect(reads.length).toBeGreaterThan(0);
        for (const read of reads) {
          expect(read.planSummary).not.toContain('COLLSCAN');
          // 300 bulk users: without the `{permissions}`/`{groups}` indexes the lookup walks them all (308 examined).
          expect(read.docsExamined).toBeLessThan(20);
        }
      });
    });

    describe('a message', () => {
      it('alerts the owner at high priority when staff answer, and the other assignees at normal', async () => {
        const ticket = await createTicket(api, {
          creator: people.creator.id,
          assignees: [people.assignee.id, people.staff.id],
        });
        await post('staff', ticket._id, 'Đã xử lý').expect(201);
        const [owner] = await rowsOf('creator');
        expect(owner).toMatchObject({
          kind: 'ticket-message',
          priority: 'high',
          title: 'Phiếu hỗ trợ có trả lời mới',
          groupKey: groupOf(ticket._id),
        });
        expect(owner.body).toContain('Đã xử lý');
        const [colleague] = await rowsOf('assignee');
        expect(colleague).toMatchObject({
          kind: 'ticket-message',
          priority: 'normal',
        });
        expect(await rowsOf('staff')).toHaveLength(0);
      });
    });

    describe('closing, reopening and assigning', () => {
      it('alerts a newly assigned user and marks a removed assignees unread rows for the ticket read', async () => {
        const ticket = await createTicket(api, {
          creator: people.creator.id,
          assignees: [people.assignee.id],
        });
        const other = await createTicket(api, {
          creator: people.creator.id,
          assignees: [people.assignee.id],
        });
        await post('creator', ticket._id, 'a').expect(201);
        await post('creator', other._id, 'b').expect(201);
        await patch('staff', ticket._id, { assignees: ['newcomer'] }).expect(
          200,
        );
        const [fresh] = await rowsOf('newcomer');
        expect(fresh).toMatchObject({ kind: 'ticket-new', unread: true });
        expect(fresh.title).toContain('được giao');
        const state = Object.fromEntries(
          (await rowsOf('assignee')).map((row) => [row.groupKey, row.unread]),
        );
        expect(state).toEqual({
          [groupOf(ticket._id)]: false,
          [groupOf(other._id)]: true,
        });
      });
    });

    it('never fails the ticket write when the inbox write fails', async () => {
      const merge = jest
        .spyOn(api.app.get(NotificationsRepository), 'merge')
        .mockRejectedValue(new Error('mongo down'));
      const ticket = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
      });
      await post('creator', ticket._id, 'still saved').expect(201);
      await patch('creator', ticket._id, { isOpen: false }).expect(200);
      merge.mockRestore();
      const stored = await api.tickets.findById(ticket._id).lean();
      expect(stored?.messageCount).toBe(2);
      expect(stored?.isOpen).toBe(false);
      expect(await api.notifications.countDocuments()).toBe(0);
    });
  });
}
