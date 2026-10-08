import type { TicketListItemResponse } from '../src/modules/tickets/core/dto/ticket.response';
import { authed } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn } from './ticket-fixtures';

describe('ticket list open filter', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

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
