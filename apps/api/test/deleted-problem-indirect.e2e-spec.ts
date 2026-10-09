import { TicketContextService } from '../src/modules/tickets/core/ticket-context.service';
import { softDelete } from './deleted-problem-fixtures';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('tickets of a deleted problem', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let creator: { id: string; session: TestSession };
  let author: { id: string; session: TestSession };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const filer = await signedIn(api, 'dp_filer');
    const owner = await signedIn(api, 'dp_author');
    creator = { id: filer.user._id, session: filer.session };
    author = { id: owner.user._id, session: owner.session };
  });
  afterAll(() => api.teardown());

  it('shows the linked problem as deleted and keeps the ticket readable by its creator and assignees', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'dp_linked',
      authors: [author.id],
    });
    const ticket = await createTicket(api, {
      creator: creator.id,
      assignees: [author.id],
      problem: problem._id,
    });
    await softDelete(api, problem._id);
    const links = await api.app.get(TicketContextService).links([ticket]);
    expect(links.get(ticket._id)).toEqual({
      type: 'problem',
      id: problem._id,
      key: null,
      title: 'Deleted problem',
      url: '',
    });
    await authed(api.http().get(ticketUrl(ticket._id)), creator.session).expect(
      200,
    );
    await authed(api.http().get(ticketUrl(ticket._id)), author.session).expect(
      200,
    );
  });

  it('refuses to file a new ticket on a deleted problem like on an unknown one', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'dp_filing',
      isPublic: true,
    });
    await softDelete(api, problem._id);
    await authed(
      api.http().post(`/api/internal/problems/${problem.code}/tickets`),
      creator.session,
    )
      .send({ title: 'Help', body: 'Where did it go?' })
      .expect(404);
    expect(await api.tickets.countDocuments({ title: 'Help' })).toBe(0);
  });
});
