import type { User } from '@libs/database';
import type { AnnouncementResponse } from '../src/modules/contests/announcements/dto/announcement.response';
import type {
  TicketDetailResponse,
  TicketListItemResponse,
} from '../src/modules/tickets/core/dto/ticket.response';
import {
  clearRateLimits,
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

const EDIT_OWN = ['judge.edit_own_contest'];

describe('contest tickets (questions to the organisers)', () => {
  let api: ApiTest;
  const people: Record<string, { id: string; session: TestSession }> = {};
  const ask = (who: string, key: string, body: Record<string, unknown>) =>
    authed(
      api.http().post(contestUrl(key, '/tickets')),
      people[who].session,
    ).send({ title: 'Bài 1', body: 'n có thể bằng 0?', ...body });
  const get = (who: string, path: string) =>
    authed(api.http().get(path), people[who].session);
  const contestTickets = async (who: string, key: string) =>
    (
      (await get(who, contestUrl(key, '/tickets')).expect(200)).body as {
        data: TicketListItemResponse[];
      }
    ).data.map((ticket) => ticket.id);
  const allTickets = async (who: string) =>
    (
      (await get(who, '/api/internal/tickets').expect(200)).body as {
        data: TicketListItemResponse[];
      }
    ).data.map((ticket) => ticket.id);

  let contestKey: string;
  let contestId: string;

  beforeAll(async () => {
    api = await setupApiTest();
    const catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['contestant', {}],
      ['rival', {}],
      ['author', { permissions: EDIT_OWN }],
      ['curator', { permissions: EDIT_OWN }],
      ['otherAuthor', { permissions: EDIT_OWN }],
      ['staff', { permissions: ['judge.change_ticket'] }],
      ['muted', { mute: true }],
    ];
    for (const [name, extra] of roles) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
    const inContest = await createProblem(api, catalog, {
      code: 'ct_hidden',
      isPublic: false,
    });
    await createProblem(api, catalog, { code: 'ct_elsewhere' });
    const contest = await createContest(api, {
      authors: [people.author.id],
      curators: [people.curator.id],
      problems: [contestProblem(inContest._id, 1)],
    });
    await createContest(api, { authors: [people.otherAuthor.id] });
    contestKey = contest.key;
    contestId = contest._id;
    const participation = await joinParticipation(
      api,
      contestId,
      people.contestant.id,
    );
    await makeCurrent(api, people.contestant.id, participation._id);
  });
  beforeEach(() => clearRateLimits(api));
  afterAll(() => api.teardown());

  it('files a question about the contest, assigned to its authors', async () => {
    const ticket = dataOf<TicketDetailResponse>(
      await ask('contestant', contestKey, {}).expect(201),
    );
    expect(ticket.link).toMatchObject({
      type: 'contest',
      id: contestId,
      key: contestKey,
      url: `/contests/${contestKey}`,
    });
    expect(ticket.contest).toEqual({ key: contestKey, name: 'Contest' });
    expect(ticket.assignees.map((user) => user.username).sort()).toEqual([
      'author',
      'curator',
    ]);
  });

  it('files about one of its problems by code, and refuses other problems and hidden contests', async () => {
    const ticket = dataOf<TicketDetailResponse>(
      await ask('contestant', contestKey, { problem: 'ct_hidden' }).expect(201),
    );
    expect([ticket.link.type, ticket.link.key, ticket.contest?.key]).toEqual([
      'problem',
      'ct_hidden',
      contestKey,
    ]);
    await ask('contestant', contestKey, { problem: 'ct_elsewhere' }).expect(
      404,
    );
    // Not in the contest: its hidden problem is as unknown as anywhere else.
    await ask('rival', contestKey, { problem: 'ct_hidden' }).expect(404);
    await ask('contestant', contestKey, { problem: 'nope' }).expect(404);
    await ask('contestant', 'no_such_contest', {}).expect(404);
    const hidden = await createContest(api, { isVisible: false });
    await ask('contestant', hidden.key, {}).expect(404);
    await ask('muted', contestKey, {}).expect(403);
  });

  it('lets a contestant read only their own; the contest editors and staff read every one', async () => {
    const mine = dataOf<TicketDetailResponse>(
      await ask('contestant', contestKey, {}).expect(201),
    ).id;
    const theirs = dataOf<TicketDetailResponse>(
      await ask('rival', contestKey, {}).expect(201),
    ).id;

    expect(await contestTickets('contestant', contestKey)).toContain(mine);
    expect(await contestTickets('contestant', contestKey)).not.toContain(
      theirs,
    );
    await get('contestant', ticketUrl(theirs)).expect(403);
    await get('rival', ticketUrl(mine)).expect(403);
    await get('contestant', ticketUrl(mine)).expect(200);

    for (const organiser of ['author', 'curator', 'staff']) {
      expect(await contestTickets(organiser, contestKey)).toEqual(
        expect.arrayContaining([mine, theirs]),
      );
      await get(organiser, ticketUrl(theirs)).expect(200);
    }
    expect(await allTickets('curator')).toEqual(
      expect.arrayContaining([mine, theirs]),
    );

    await get('otherAuthor', ticketUrl(mine)).expect(403);
    expect(await allTickets('otherAuthor')).not.toContain(mine);
    expect(await contestTickets('otherAuthor', contestKey)).toEqual([]);
  });

  it('lets an organiser who is not an assignee reply to a question', async () => {
    const id = dataOf<TicketDetailResponse>(
      await ask('contestant', contestKey, {}).expect(201),
    ).id;
    await authed(
      api.http().post(ticketUrl(id, '/messages')),
      people.curator.session,
    )
      .send({ body: 'Có, n có thể bằng 0.' })
      .expect(201);
    await authed(
      api.http().post(ticketUrl(id, '/messages')),
      people.rival.session,
    )
      .send({ body: 'me too' })
      .expect(403);
  });

  it('ties a problem ticket filed from inside the contest to it, until staff move it elsewhere', async () => {
    const id = dataOf<TicketDetailResponse>(
      await authed(
        api.http().post('/api/internal/problems/ct_hidden/tickets'),
        people.contestant.session,
      )
        .send({ title: 'Test 3', body: 'sai?' })
        .expect(201),
    ).id;
    await get('curator', ticketUrl(id)).expect(200);
    expect(await contestTickets('curator', contestKey)).toContain(id);
    await authed(api.http().patch(ticketUrl(id)), people.staff.session)
      .send({ problem: 'ct_elsewhere' })
      .expect(200);
    await get('curator', ticketUrl(id)).expect(403);
    expect(await contestTickets('curator', contestKey)).not.toContain(id);
  });

  it('names the contest only to readers who can see it', async () => {
    const hidden = await createContest(api, {
      isVisible: false,
      authors: [people.author.id],
    });
    const ticket = await createTicket(api, {
      creator: people.rival.id,
      contest: hidden._id,
    });
    const read = async (who: string) =>
      dataOf<TicketDetailResponse>(
        await get(who, ticketUrl(ticket._id)).expect(200),
      ).contest;
    expect(await read('author')).toEqual({ key: hidden.key, name: 'Contest' });
    expect(await read('rival')).toBeNull();
  });

  it('links #label in an announcement to the contest problem once the contest started', async () => {
    const upcoming = await createContest(api, {
      authors: [people.author.id],
      startTime: hoursFromNow(1),
      endTime: hoursFromNow(3),
      problems: (await api.contests.findById(contestId))!.problems,
    });
    const early = dataOf<AnnouncementResponse>(
      await authed(
        api.http().post(contestUrl(upcoming.key, '/announcements')),
        people.author.session,
      )
        .send({ title: 'Sắp thi', description: 'Xem #1.' })
        .expect(201),
    );
    expect(early.descriptionHtml).toBe('<p>Xem #1.</p>\n');
    const announcement = dataOf<AnnouncementResponse>(
      await authed(
        api.http().post(contestUrl(contestKey, '/announcements')),
        people.author.session,
      )
        .send({ title: 'Sửa đề', description: '#1: n ≥ 0. Xem `#1`, #2.' })
        .expect(201),
    );
    expect(announcement.descriptionHtml).toBe(
      '<p><a href="/problems/ct_hidden">#1</a>: n ≥ 0. Xem <code>#1</code>, #2.</p>\n',
    );
  });
});
