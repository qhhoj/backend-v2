import type {
  TicketListItemResponse,
  TicketDetailResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';
import { newId } from '@libs/database';
import type { User } from '@libs/database';
import type { TestSession, Catalog } from './problem-fixtures';
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
