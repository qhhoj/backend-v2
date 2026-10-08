import { newId } from '@libs/database';
import type { User } from '@libs/database';
import type {
  TicketDetailResponse,
  TicketListItemResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import { profileQueries } from '@libs/database/testing';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('ticket reads', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
          permissions: ['judge.edit_own_problem', 'judge.edit_public_problem'],
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
  afterAll(() => api.teardown());

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
      expect([who, (await listIds(who)).sort()]).toEqual([who, expected]);
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

  it('reads every list through an index, with no blocking sort', async () => {
    const lists = [
      ['staff', '/api/internal/tickets'],
      ['staff', '/api/internal/tickets?open=true&user=creator'],
      ['creator', '/api/internal/tickets?own=true'],
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
      expect([
        who,
        path,
        ticketReads.filter(({ hasSortStage }) => hasSortStage),
      ]).toEqual([who, path, []]);
    }
  });
});
