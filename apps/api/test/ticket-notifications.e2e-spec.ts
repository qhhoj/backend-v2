import { NotificationsRepository } from '@libs/community';
import type { User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { TicketDetailResponse } from '../src/modules/tickets/core/dto/ticket.response';
import { clearRateLimits } from './contest-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('ticket alerts', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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

    it('does not alert staff who file the ticket themselves', async () => {
      await authed(
        api.http().post('/api/internal/tickets/general'),
        as('staff'),
      )
        .send({ title: 'Nội bộ', body: 'x', issueUrl: 'https://example.com/y' })
        .expect(201);
      expect(await rowsOf('staff')).toHaveLength(0);
      expect(await rowsOf('staff2')).toHaveLength(1);
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
        authed(api.http().post('/api/internal/tickets/general'), as('creator'))
          .send({ title: 'Idx', body: 'x', issueUrl: 'https://example.com/z' })
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

    it('alerts an owner who is also an assignee once, at the owner priority', async () => {
      const ticket = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.creator.id, people.assignee.id],
      });
      await post('staff', ticket._id, 'Đã xử lý').expect(201);
      const rows = await rowsOf('creator');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ count: 1, priority: 'high' });
      expect(await rowsOf('assignee')).toHaveLength(1);
    });

    it('alerts the assignees at normal priority when the owner replies, never the owner', async () => {
      const ticket = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
      });
      await post('creator', ticket._id, 'Cảm ơn').expect(201);
      expect((await rowsOf('assignee'))[0]).toMatchObject({
        kind: 'ticket-message',
        priority: 'normal',
      });
      expect(await rowsOf('creator')).toHaveLength(0);
    });

    it('merges a conversation into one unread row per person, newest text on it', async () => {
      const ticket = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
      });
      await post('assignee', ticket._id, 'một').expect(201);
      await post('assignee', ticket._id, 'hai').expect(201);
      const rows = await rowsOf('creator');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ count: 2, unread: true });
      expect(rows[0].body).toContain('hai');
    });

    it('alerts staff when the owner replies on a general ticket nobody is assigned to', async () => {
      const ticket = await createTicket(api, { creator: people.creator.id });
      await post('creator', ticket._id, 'Có ai không?').expect(201);
      expect(await rowsOf('staff')).toHaveLength(1);
      expect(await rowsOf('staff2')).toHaveLength(1);
      expect(await rowsOf('root')).toHaveLength(0);
    });

    it('does not alert other staff when a staff member answers a ticket with no assignees', async () => {
      const ticket = await createTicket(api, { creator: people.creator.id });
      await post('staff', ticket._id, 'Đã rõ').expect(201);
      expect(await rowsOf('staff2')).toHaveLength(0);
      expect(await rowsOf('creator')).toHaveLength(1);
    });
  });

  describe('closing, reopening and assigning', () => {
    it('alerts the owner and the assignees except whoever closed it', async () => {
      const ticket = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
      });
      await patch('creator', ticket._id, { isOpen: false }).expect(200);
      expect((await rowsOf('assignee'))[0]).toMatchObject({
        kind: 'ticket-status',
      });
      expect((await rowsOf('assignee'))[0].title).toContain('đóng');
      expect(await rowsOf('creator')).toHaveLength(0);
      await patch('assignee', ticket._id, { isOpen: true }).expect(200);
      expect((await rowsOf('creator'))[0].title).toContain('mở lại');
    });

    it('does not alert anybody for notes or marking good', async () => {
      const ticket = await createTicket(api, {
        creator: people.creator.id,
        assignees: [people.assignee.id],
      });
      await patch('staff', ticket._id, {
        notes: 'n',
        isContributive: true,
      }).expect(200);
      expect(await api.notifications.countDocuments()).toBe(0);
    });

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
      await patch('staff', ticket._id, { assignees: ['newcomer'] }).expect(200);
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
