import { uuidStr, newId } from '@libs/database';
import type { User } from '@libs/database';
import type {
  TicketDetailResponse,
  TicketListItemResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import { TicketsRepository } from '../src/modules/tickets/core/tickets.repository';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { TestSession, Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';
import { NotificationsRepository } from '@libs/community';
import { profileQueries } from '@libs/database/testing';
import {
  clearRateLimits,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';

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

// from ticket-canned-replies.e2e-spec.ts
{
  const BASE = '/api/internal/ticket-canned-replies';

  describe('ticket canned replies', () => {
    beforeAll(() => api.reset());
    const people: Record<string, { id: string; session: TestSession }> = {};
    const send = (
      who: string,
      method: 'get' | 'post' | 'patch' | 'delete',
      path = '',
      body?: object,
    ) => {
      const request = authed(
        api.http()[method](`${BASE}${path}`),
        people[who].session,
      );
      return body ? request.send(body) : request;
    };

    beforeAll(async () => {
      const accounts: Array<[string, Partial<User>]> = [
        ['staff', { permissions: ['judge.change_ticket'] }],
        ['root', { isSuperuser: true }],
        ['plain', {}],
      ];
      for (const [name, extra] of accounts) {
        const { user, session } = await signedIn(api, name, extra);
        people[name] = { id: user._id, session };
      }
    });
    beforeEach(() => api.ticketCannedReplies.deleteMany({}));

    it('is for change_ticket holders and superusers only, on every route', async () => {
      const reply = await api.ticketCannedReplies.create({
        title: 'T',
        body: 'B',
        createdBy: people.staff.id,
      });
      for (const [method, path, body] of [
        ['get', '', undefined],
        ['post', '', { title: 'x', body: 'y' }],
        ['patch', `/${reply._id}`, { title: 'z' }],
        ['delete', `/${reply._id}`, undefined],
      ] as const) {
        await send('plain', method, path, body).expect(403);
        await api.http()[method](`${BASE}${path}`).expect(401);
      }
      await send('root', 'get').expect(200);
      expect(await api.ticketCannedReplies.countDocuments()).toBe(1);
    });
  });
}

// from tickets-access.e2e-spec.ts
{
  describe('ticket reads', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    const people: Record<string, { id: string; session: TestSession }> = {};
    const tickets: Record<string, string> = {};
    const as = (who: string, path: string) =>
      authed(api.http().get(path), people[who].session);

    /** Who may read which ticket: change_ticket, creator, assignee, editor of the linked problem. */
    const READABLE: Record<string, string[]> = {
      onPublic: [
        'staff',
        'creator',
        'assignee',
        'author',
        'publicEditor',
        'allEditor',
      ],
      onPrivate: ['staff', 'creator', 'author', 'allEditor'],
      general: ['staff', 'creator'],
      byOutsider: ['staff', 'outsider', 'author', 'publicEditor', 'allEditor'],
      /** The problem is gone: no problem editor reads it, whatever the permission. */
      onDeleted: ['staff', 'creator'],
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const roles: Array<[string, Partial<User>]> = [
        ['staff', { permissions: ['judge.change_ticket'] }],
        ['creator', {}],
        ['assignee', {}],
        ['author', { permissions: ['judge.edit_own_problem'] }],
        ['plainAuthor', {}],
        ['outsider', {}],
        [
          'publicEditor',
          {
            permissions: [
              'judge.edit_own_problem',
              'judge.edit_public_problem',
            ],
          },
        ],
        [
          'allEditor',
          { permissions: ['judge.edit_own_problem', 'judge.edit_all_problem'] },
        ],
      ];
      for (const [name, extra] of roles) {
        const { user, session } = await signedIn(api, name, extra);
        people[name] = { id: user._id, session };
      }
      const open = await createProblem(api, catalog, {
        code: 'open_one',
        authors: [people.author.id, people.plainAuthor.id],
      });
      const hidden = await createProblem(api, catalog, {
        code: 'hidden_one',
        isPublic: false,
        authors: [people.author.id],
      });
      const make = async (
        name: string,
        input: Parameters<typeof createTicket>[1],
      ) => {
        tickets[name] = (await createTicket(api, input))._id;
      };
      await make('onPublic', {
        creator: people.creator.id,
        assignees: [people.assignee.id],
        problem: open._id,
        notes: 'secret staff note',
      });
      await make('onPrivate', {
        creator: people.creator.id,
        problem: hidden._id,
      });
      await make('general', { creator: people.creator.id });
      await make('byOutsider', {
        creator: people.outsider.id,
        problem: open._id,
      });
      await make('onDeleted', { creator: people.creator.id, problem: newId() });
    });

    it('returns people, the link and rendered messages; notes and edit rights only to assignees and staff', async () => {
      const asCreator = dataOf<TicketDetailResponse>(
        await as('creator', ticketUrl(tickets.onPublic)).expect(200),
      );
      expect(asCreator).toMatchObject({
        id: tickets.onPublic,
        creator: { username: 'creator' },
        assignees: [{ username: 'assignee' }],
        link: {
          type: 'problem',
          key: 'open_one',
          title: 'OPEN_ONE',
          url: '/problem/open_one',
        },
        isOpen: true,
        isContributive: false,
        messageCount: 1,
        notes: null,
        can: { editNotes: false, markGood: false, assign: false },
      });
      expect(asCreator.messages).toHaveLength(1);
      expect(asCreator.messages[0]).toMatchObject({
        author: { username: 'creator' },
        bodyHtml: '<p>help</p>',
      });
      for (const who of READABLE.onPublic) {
        const detail = dataOf<TicketDetailResponse>(
          await as(who, ticketUrl(tickets.onPublic)).expect(200),
        );
        const isTicketStaff = ['staff', 'assignee'].includes(who);
        expect([who, detail.notes]).toEqual([
          who,
          isTicketStaff ? 'secret staff note' : null,
        ]);
        expect([who, detail.can.editNotes]).toEqual([who, isTicketStaff]);
      }
      const refused = await as('outsider', ticketUrl(tickets.onPublic)).expect(
        403,
      );
      expect(JSON.stringify(refused.body)).not.toContain('secret staff note');
      const listed = dataOf<Record<string, unknown>[]>(
        await as('staff', '/api/internal/tickets').expect(200),
      );
      for (const item of listed) expect(item).not.toHaveProperty('notes');
      const general = dataOf<TicketDetailResponse>(
        await as('creator', ticketUrl(tickets.general)).expect(200),
      );
      expect(general.link).toMatchObject({
        type: 'general',
        key: null,
        title: 'https://example.com/issue',
        url: 'https://example.com/issue',
      });
    });

    it("lists a problem's tickets to its editors, and a viewer's own to everyone who can see it", async () => {
      const problemList = async (who: string, code: string) =>
        (await as(who, `/api/internal/problems/${code}/tickets`)).status === 200
          ? dataOf<TicketListItemResponse[]>(
              await as(who, `/api/internal/problems/${code}/tickets`),
            )
              .map((item) => item.id)
              .sort()
          : null;
      expect(await problemList('author', 'open_one')).toEqual(
        [tickets.onPublic, tickets.byOutsider].sort(),
      );
      expect(await problemList('staff', 'open_one')).toEqual(
        [tickets.onPublic, tickets.byOutsider].sort(),
      );
      expect(await problemList('creator', 'open_one')).toEqual([
        tickets.onPublic,
      ]);
      expect(await problemList('outsider', 'open_one')).toEqual([
        tickets.byOutsider,
      ]);
      expect(await problemList('outsider', 'hidden_one')).toBeNull();
      await as('creator', '/api/internal/problems/nope/tickets').expect(404);
      // Legacy checks `is_editable_by` first: an editor whose contest has not started keeps the list, staff without edit rights do not.
      const upcoming = await createContest(api, {
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(2),
      });
      for (const who of ['author', 'staff'])
        await makeCurrent(
          api,
          people[who].id,
          (await joinParticipation(api, upcoming._id, people[who].id))._id,
        );
      expect(await problemList('author', 'open_one')).toEqual(
        [tickets.onPublic, tickets.byOutsider].sort(),
      );
      expect(await problemList('staff', 'open_one')).toBeNull();
      for (const who of ['author', 'staff'])
        await makeCurrent(api, people[who].id, null);
    });
  });
}
