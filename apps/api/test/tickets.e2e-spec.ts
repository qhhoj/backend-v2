import type {
  TicketListItemResponse,
  TicketDetailResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest, errorCode } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';
import { newId, toUuid } from '@libs/database';
import type { Collection, UUID } from 'mongodb';
import type { User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { TicketSummaryResponse } from '../src/modules/tickets/alerts/dto/ticket-summary.response';
import type { TestSession, Catalog } from './problem-fixtures';
import { TICKET_CANNED_REPLIES_MAX } from '@libs/community';
import type { CannedReplyResponse } from '../src/modules/tickets/canned/dto/canned-reply.response';
import {
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

// from tickets-list-filter.e2e-spec.ts
{
  describe('ticket list open filter', () => {
    beforeAll(() => api.reset());
    beforeAll(async () => {});

    it('lists open, closed or both tickets of the viewer', async () => {
      const { user, session } = await signedIn(api, 'ticketeer');
      const open = await createTicket(api, { creator: user._id, isOpen: true });
      const closed = await createTicket(api, {
        creator: user._id,
        isOpen: false,
      });
      const ids = async (query: string) =>
        dataOf<TicketListItemResponse[]>(
          await authed(
            api.http().get(`/api/internal/tickets?own=true${query}`),
            session,
          ).expect(200),
        ).map((item) => String(item.id));
      expect(await ids('&open=true')).toEqual([String(open._id)]);
      expect(await ids('&open=false')).toEqual([String(closed._id)]);
      expect((await ids('')).sort()).toEqual(
        [String(open._id), String(closed._id)].sort(),
      );
    });
  });
}

// from ticket-summary.e2e-spec.ts
{
  const SUMMARY = '/api/internal/tickets/summary';

  describe('ticket summary', () => {
    beforeAll(() => api.reset());
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
      it('keeps a ticket waiting after a reply from a non-staff assignee', async () => {
        const ticket = await createTicket(api, {
          creator: people.creator.id,
          assignees: [people.assignee.id],
          lastMessageByStaff: true,
        });
        expect((await summary('staff')).awaitingStaff).toBe(0);
        await post('assignee', ticket._id, 'looking').expect(201);
        expect((await summary('staff')).awaitingStaff).toBe(1);
      });

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
        const byUser = dataOf<{ id: string }>(
          await file('creator').expect(201),
        );
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
    const listed = async (who = 'staff') =>
      dataOf<CannedReplyResponse[]>(await send(who, 'get').expect(200));

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

    it('creates, lists in order, edits and deletes', async () => {
      const create = async (body: object) =>
        dataOf<CannedReplyResponse>(
          await send('staff', 'post', '', body).expect(201),
        );
      const first = await create({
        title: '  Đã nhận  ',
        body: 'Chào {tên}, bài {bài} đã được ghi nhận.',
      });
      expect(first).toMatchObject({
        title: 'Đã nhận',
        body: 'Chào {tên}, bài {bài} đã được ghi nhận.',
        order: 0,
      });
      expect((await create({ title: 'Hai', body: 'b' })).order).toBe(1);
      await create({ title: 'Cuối', body: 'b', order: 7 });
      expect((await create({ title: 'Tám', body: 'b' })).order).toBe(8);
      const titles = async () => (await listed()).map((reply) => reply.title);
      expect(await titles()).toEqual(['Đã nhận', 'Hai', 'Cuối', 'Tám']);

      const second = (await listed())[1];
      await send('staff', 'patch', `/${second.id}`, {
        order: 9,
        body: 'mới',
      }).expect(200);
      expect(
        (await listed()).map((reply) => [reply.title, reply.body]),
      ).toEqual([
        ['Đã nhận', 'Chào {tên}, bài {bài} đã được ghi nhận.'],
        ['Cuối', 'b'],
        ['Tám', 'b'],
        ['Hai', 'mới'],
      ]);
      await send('staff', 'delete', `/${first.id}`).expect(204);
      expect(await titles()).toEqual(['Cuối', 'Tám', 'Hai']);
    });

    it('stores the placeholders verbatim: the SPA fills them in', async () => {
      const created = dataOf<CannedReplyResponse>(
        await send('staff', 'post', '', {
          title: 'P',
          body: '{tên} / {bài}',
        }).expect(201),
      );
      const stored = await api.ticketCannedReplies.findById(created.id).lean();
      expect(stored?.body).toBe('{tên} / {bài}');
    });

    it('answers 404 for an unknown or malformed id', async () => {
      await send('staff', 'patch', `/${newId()}`, { title: 'x' }).expect(404);
      await send('staff', 'patch', '/not-a-uuid', { title: 'x' }).expect(404);
      await send('staff', 'delete', `/${newId()}`).expect(404);
      await send('staff', 'delete', '/not-a-uuid').expect(404);
    });

    it('validates title, body and order', async () => {
      const bad = [
        { title: '', body: 'b' },
        { title: '   ', body: 'b' },
        { title: 'x'.repeat(61), body: 'b' },
        { title: 't', body: '' },
        { title: 't', body: 'x'.repeat(8193) },
        { title: 't', body: 'b', order: -1 },
        { title: 't', body: 'b', order: 1.5 },
        { body: 'b' },
        { title: 't', body: 'b', order: null },
      ];
      for (const body of bad) await send('staff', 'post', '', body).expect(400);
      const reply = await api.ticketCannedReplies.create({
        title: 'T',
        body: 'B',
        createdBy: people.staff.id,
      });
      await send('staff', 'patch', `/${reply._id}`, { title: null }).expect(
        400,
      );
      await send('staff', 'patch', `/${reply._id}`, {
        title: 'x'.repeat(61),
      }).expect(400);
    });

    it('refuses the 101st canned reply with 409', async () => {
      await api.ticketCannedReplies.insertMany(
        Array.from({ length: TICKET_CANNED_REPLIES_MAX }, (_unused, index) => ({
          title: `T${index}`,
          body: 'b',
          order: index,
          createdBy: people.staff.id,
        })),
      );
      await send('staff', 'post', '', { title: 'one more', body: 'b' })
        .expect(409)
        .expect(errorCode('conflict'));
      expect((await listed()).length).toBe(TICKET_CANNED_REPLIES_MAX);
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
    const listIds = async (who: string, query = '') =>
      dataOf<TicketListItemResponse[]>(
        await as(who, `/api/internal/tickets${query}`).expect(200),
      ).map((item) => item.id);

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

    it('grants and refuses detail by role', async () => {
      for (const [name, readers] of Object.entries(READABLE))
        for (const who of Object.keys(people)) {
          const status = readers.includes(who) ? 200 : 403;
          const response = await as(who, ticketUrl(tickets[name]));
          expect([name, who, response.status]).toEqual([name, who, status]);
          if (status === 403)
            expect(
              (response.body as { error: { code: string } }).error.code,
            ).toBe('forbidden');
        }
    });

    it('lists exactly the tickets whose detail is readable', async () => {
      for (const who of Object.keys(people)) {
        const expected = Object.entries(READABLE)
          .filter(([, readers]) => readers.includes(who))
          .map(([name]) => tickets[name])
          .sort();
        const response = await as(who, '/api/internal/tickets').expect(200);
        const body = response.body as {
          data: { id: string }[];
          meta: { total: number };
        };
        expect([who, body.data.map((item) => item.id).sort()]).toEqual([
          who,
          expected,
        ]);
        expect([who, body.meta.total]).toEqual([who, expected.length]);
      }
    });

    it('needs a session and treats unknown or malformed ids as missing', async () => {
      await api.http().get('/api/internal/tickets').expect(401);
      await api.http().get(ticketUrl(tickets.onPublic)).expect(401);
      await as('creator', ticketUrl(newId()))
        .expect(404)
        .expect(errorCode('not_found'));
      await as('creator', ticketUrl('not-a-uuid')).expect(404);
    });

    it('returns people, the link and rendered messages; notes to every reader, edit rights only to assignees and staff', async () => {
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
        notes: 'secret staff note',
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
        expect([who, detail.notes]).toEqual([who, 'secret staff note']);
        expect([who, detail.can.editNotes]).toEqual([
          who,
          ['staff', 'assignee'].includes(who),
        ]);
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

    it('filters by own, open, creator and assignee', async () => {
      await api.tickets.updateOne({ _id: tickets.general }, { isOpen: false });
      expect((await listIds('creator', '?own=true')).sort()).toEqual(
        [
          tickets.onPublic,
          tickets.onPrivate,
          tickets.general,
          tickets.onDeleted,
        ].sort(),
      );
      expect(await listIds('staff', '?own=true')).toEqual([]);
      expect(await listIds('staff', '?user=outsider')).toEqual([
        tickets.byOutsider,
      ]);
      const filtered = await as('staff', '/api/internal/tickets?user=outsider');
      expect((filtered.body as { meta: { total: number } }).meta.total).toBe(1);
      expect(await listIds('staff', '?assignee=assignee')).toEqual([
        tickets.onPublic,
      ]);
      expect(
        await listIds('staff', '?user=outsider&user=creator&open=true'),
      ).toHaveLength(4);
      expect(await listIds('staff', '?user=nobody')).toEqual([]);
      await api.tickets.updateOne({ _id: tickets.general }, { isOpen: true });
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

    it('pages 50 per page, newest first, with a total', async () => {
      await api.tickets.insertMany(
        Array.from({ length: 52 }, (_unused, index) => ({
          title: `Bulk ${index}`,
          user: people.creator.id,
          linkedItem: { type: 'general', id: newId() },
        })),
      );
      const first = await as('staff', '/api/internal/tickets').expect(200);
      const second = await as('staff', '/api/internal/tickets?page=2').expect(
        200,
      );
      expect((first.body as { data: unknown[] }).data).toHaveLength(50);
      expect((first.body as { meta: unknown }).meta).toEqual({
        page: 1,
        pageSize: 50,
        total: 57,
      });
      expect((second.body as { data: unknown[] }).data).toHaveLength(7);
      const ids = [
        ...(first.body as { data: { id: string }[] }).data,
        ...(second.body as { data: { id: string }[] }).data,
      ].map((item) => item.id);
      expect(new Set(ids).size).toBe(57);
      expect(ids.slice(-5).sort()).toEqual(Object.values(tickets).sort());
    });

    it('reads every list through an index, with no unbounded blocking sort', async () => {
      const lists = [
        ['staff', '/api/internal/tickets'],
        ['staff', '/api/internal/tickets?open=true&user=creator'],
        ['creator', '/api/internal/tickets?own=true'],
        ['creator', '/api/internal/tickets?own=true&open=true'],
        ['creator', '/api/internal/tickets?open=true'],
        ['author', '/api/internal/tickets?open=true'],
        ['allEditor', '/api/internal/tickets?open=true'],
        ['creator', '/api/internal/tickets'],
        ['plainAuthor', '/api/internal/tickets'],
        ['author', '/api/internal/tickets'],
        ['publicEditor', '/api/internal/tickets'],
        ['allEditor', '/api/internal/tickets'],
        ['author', '/api/internal/problems/open_one/tickets'],
        ['creator', '/api/internal/problems/open_one/tickets'],
      ];
      for (const [who, path] of lists) {
        const operations = await profileQueries(api.db, () =>
          as(who, path).expect(200),
        );
        const ticketReads = operations.filter(
          ({ collection }) => collection === 'tickets',
        );
        expect([who, path, ticketReads.length > 0]).toEqual([who, path, true]);
        expect([
          who,
          path,
          ticketReads.filter(({ planSummary }) =>
            planSummary.includes('COLLSCAN'),
          ),
        ]).toEqual([who, path, []]);
        // With `open` the planner may merge the visibility branches and sort the union in memory: allowed only while it
        // reads nothing but the viewer's readable tickets (bounded by what they may see, never the whole collection).
        const OR_BRANCHES = 3; // creator, assignee, linked problem: a ticket may be fetched once per branch
        const readable =
          Object.values(READABLE).filter((readers) => readers.includes(who))
            .length + (who === 'creator' ? 52 : 0);
        const sorted = ticketReads.filter(({ hasSortStage }) => hasSortStage);
        expect([
          who,
          path,
          sorted.length > 0 && !path.includes('open=true'),
        ]).toEqual([who, path, false]);
        for (const read of sorted)
          expect(read.docsExamined).toBeLessThanOrEqual(readable * OR_BRANCHES);
      }
    });
  });
}
