import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type {
  TicketDetailResponse,
  TicketListItemResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import { createContest } from './contest-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('ticket claims, "about mine" and text search', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const people: Record<string, { id: string; session: TestSession }> = {};
  const as = (who: string) => people[who].session;
  const claim = (who: string, id: string) =>
    authed(api.http().post(ticketUrl(id, '/claim')), as(who));
  const release = (who: string, id: string) =>
    authed(api.http().delete(ticketUrl(id, '/claim')), as(who));
  const assigneesOf = async (id: string) =>
    (await api.tickets.findById(id).lean())!.assignees.map(uuidStr).sort();
  const summaryOf = async (who: string) =>
    dataOf<{ aboutMineOpen: number }>(
      await authed(
        api.http().get('/api/internal/tickets/summary'),
        as(who),
      ).expect(200),
    ).aboutMineOpen;
  const list = async (who: string, query: Record<string, string>) =>
    dataOf<TicketListItemResponse[]>(
      await authed(api.http().get('/api/internal/tickets'), as(who))
        .query(query)
        .expect(200),
    ).map((item) => item.title);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const accounts: Array<[string, Partial<User>]> = [
      ['creator', {}],
      ['staffA', { permissions: ['judge.change_ticket'] }],
      ['staffB', { permissions: ['judge.change_ticket'] }],
      ['setter', { permissions: ['judge.edit_own_problem'] }],
      ['otherSetter', { permissions: ['judge.edit_own_problem'] }],
      ['summarySetter', { permissions: ['judge.edit_own_problem'] }],
      ['outsider', {}],
      ['contestAuthor', { permissions: ['judge.edit_own_contest'] }],
      ['contestCurator', { permissions: ['judge.edit_own_contest'] }],
      ['otherOrganiser', { permissions: ['judge.edit_own_contest'] }],
    ];
    for (const [name, extra] of accounts) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
  });
  afterAll(() => api.teardown());

  it('gives an unhandled ticket to the first claimer and refuses the second', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const answer = dataOf<TicketDetailResponse>(
      await claim('staffA', ticket._id).expect(200),
    );
    expect(answer.assignees.map((user) => user.username)).toEqual(['staffA']);
    await claim('staffB', ticket._id)
      .expect(409)
      .expect(errorCode('ticket_claimed'));
    // claiming again what one already handles changes nothing
    await claim('staffA', ticket._id).expect(200);
    expect(await assigneesOf(ticket._id)).toEqual([people.staffA.id]);
  });

  it('lets exactly one of two simultaneous claimers win', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const answers = await Promise.all([
      claim('staffA', ticket._id),
      claim('staffB', ticket._id),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    const loser = answers.find((answer) => answer.status === 409)!;
    errorCode('ticket_claimed')(loser);
    const assignees = await assigneesOf(ticket._id);
    expect(assignees).toHaveLength(1);
    expect([people.staffA.id, people.staffB.id]).toContain(assignees[0]);
  });

  it('refuses to claim a closed ticket', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      isOpen: false,
    });
    await claim('staffA', ticket._id)
      .expect(409)
      .expect(errorCode('ticket_closed'));
    expect(await assigneesOf(ticket._id)).toEqual([]);
  });

  it('records the claim on the timeline', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    const answer = dataOf<TicketDetailResponse>(
      await claim('staffA', ticket._id).expect(200),
    );
    const events = answer.timeline.flatMap((entry) =>
      entry.event ? [entry.event] : [],
    );
    expect(events).toMatchObject([
      {
        type: 'assigned',
        actor: { username: 'staffA' },
        target: { username: 'staffA' },
      },
    ]);
  });

  it('hands a ticket back and keeps the other handlers', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.staffA.id, people.staffB.id],
    });
    await release('staffA', ticket._id).expect(200);
    expect(await assigneesOf(ticket._id)).toEqual([people.staffB.id]);
    // after the hand-back the ticket is still handled, by staffB
    await claim('staffA', ticket._id)
      .expect(409)
      .expect(errorCode('ticket_claimed'));
  });

  it('lets an editor of the linked problem claim, and nobody else without staff rights', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'claimmine',
      authors: [people.setter.id],
    });
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      problem: problem._id,
    });
    const general = await createTicket(api, { creator: people.creator.id });
    await claim('creator', ticket._id).expect(403);
    await claim('otherSetter', ticket._id).expect(403);
    await claim('setter', general._id).expect(403);
    const answer = dataOf<TicketDetailResponse>(
      await claim('setter', ticket._id).expect(200),
    );
    expect(answer.can.claim).toBe(true);
    expect(await assigneesOf(ticket._id)).toEqual([people.setter.id]);
  });

  it('lists only tickets about the caller own problems with aboutMine, also for staff', async () => {
    const [mine, curated, theirs] = await Promise.all([
      createProblem(api, catalog, {
        code: 'aboutmine1',
        authors: [people.staffA.id],
      }),
      createProblem(api, catalog, {
        code: 'aboutmine2',
        curators: [people.staffA.id],
      }),
      createProblem(api, catalog, {
        code: 'aboutmine3',
        authors: [people.otherSetter.id],
      }),
    ]);
    for (const [title, problem] of [
      ['About authored', mine],
      ['About curated', curated],
      ['About theirs', theirs],
    ] as const)
      await createTicket(api, {
        creator: people.creator.id,
        problem: problem._id,
        title,
      });
    const titles = await list('staffA', { aboutMine: 'true' });
    expect(titles.sort()).toEqual(['About authored', 'About curated']);
  });

  it('counts the open tickets about the caller own problems in the summary', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'summarymine',
      authors: [people.summarySetter.id],
    });
    await createTicket(api, {
      creator: people.creator.id,
      problem: problem._id,
    });
    await createTicket(api, {
      creator: people.creator.id,
      problem: problem._id,
      isOpen: false,
    });
    expect(await summaryOf('summarySetter')).toBe(1);
    expect(await summaryOf('outsider')).toBe(0);
  });

  it('finds tickets by text in the title or by the creator username', async () => {
    await createTicket(api, {
      creator: people.creator.id,
      title: 'Bài trash_07 thiếu giới hạn',
    });
    await createTicket(api, {
      creator: people.outsider.id,
      title: 'Không nộp được bài',
    });
    expect(await list('staffA', { q: 'THIẾU GIỚI' })).toEqual([
      'Bài trash_07 thiếu giới hạn',
    ]);
    expect(await list('staffA', { q: 'outsider' })).toEqual([
      'Không nộp được bài',
    ]);
    expect(await list('staffA', { q: 'thieu gioi' })).toEqual([
      'Bài trash_07 thiếu giới hạn',
    ]);
    // a regex character is matched as text, and a blank text filters nothing
    expect(await list('staffA', { q: '.*' })).toEqual([]);
    expect((await list('staffA', { q: ' ' })).length).toBeGreaterThan(2);
  });

  it('lets an editor of the contest a ticket was filed from claim it, and not another contest organiser', async () => {
    const contest = await createContest(api, {
      authors: [people.contestAuthor.id],
    });
    await createContest(api, { authors: [people.otherOrganiser.id] });
    const question = await createTicket(api, {
      creator: people.creator.id,
      contest: contest._id,
    });
    await claim('otherOrganiser', question._id).expect(403);
    const answer = dataOf<TicketDetailResponse>(
      await claim('contestAuthor', question._id).expect(200),
    );
    expect(answer.can.claim).toBe(true);
    expect(await assigneesOf(question._id)).toEqual([people.contestAuthor.id]);
  });

  it('lists and counts the tickets filed from contests the caller authors or curates as about them', async () => {
    const mine = await createContest(api, {
      authors: [people.otherOrganiser.id],
      curators: [people.contestCurator.id],
    });
    const theirs = await createContest(api, {
      authors: [people.otherOrganiser.id],
    });
    for (const [title, contest, isOpen] of [
      ['Asked in my contest', mine, true],
      ['Settled in my contest', mine, false],
      ['Asked elsewhere', theirs, true],
    ] as const)
      await createTicket(api, {
        creator: people.creator.id,
        contest: contest._id,
        title,
        isOpen,
      });
    const titles = await list('contestCurator', { aboutMine: 'true' });
    expect(titles.sort()).toEqual([
      'Asked in my contest',
      'Settled in my contest',
    ]);
    expect(await summaryOf('contestCurator')).toBe(1);
  });
});
