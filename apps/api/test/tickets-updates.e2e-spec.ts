import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import {
  CONTRIBUTION_POINTS_QUEUE,
  TICKET_EVENTS_CHANNEL,
} from '@libs/community';
import type { TicketEvent } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type { TicketDetailResponse } from '../src/modules/tickets/core/dto/ticket.response';
import { clearContributionQueue } from './community-fixtures';
import { authed } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

describe('ticket updates', () => {
  let api: ApiTest;
  let contributions: Queue;
  let subscriber: Redis;
  const events: TicketEvent[] = [];
  const people: Record<string, { id: string; session: TestSession }> = {};
  const patch = (who: string, id: string, body: Record<string, unknown>) =>
    authed(api.http().patch(ticketUrl(id)), people[who].session).send(body);
  const stored = (id: string) => api.tickets.findById(id).lean();
  const queuedUsers = async (): Promise<Array<{ userId: string }>> =>
    (await contributions.getJobs(['waiting', 'delayed'])).map(
      (job) => job.data as { userId: string },
    );

  beforeAll(async () => {
    api = await setupApiTest();
    contributions = api.app.get(getQueueToken(CONTRIBUTION_POINTS_QUEUE));
    subscriber = api.app.get<Redis>(REDIS).duplicate();
    await subscriber.subscribe(TICKET_EVENTS_CHANNEL);
    subscriber.on('message', (_channel, raw) =>
      events.push(JSON.parse(raw) as TicketEvent),
    );
    const accounts: Array<[string, Partial<User>]> = [
      ['creator', {}],
      ['assignee', {}],
      ['staff', { permissions: ['judge.change_ticket'] }],
      ['staffCreator', { permissions: ['judge.change_ticket'] }],
      ['outsider', {}],
      ['newAssignee', {}],
      ['inactive', { isActive: false }],
      ['author', { permissions: ['judge.edit_own_problem'] }],
    ];
    for (const [name, extra] of accounts) {
      const { user, session } = await signedIn(api, name, extra);
      people[name] = { id: user._id, session };
    }
  });
  beforeEach(async () => {
    await clearContributionQueue(api);
    events.length = 0;
  });
  afterAll(async () => {
    await subscriber.quit();
    await api.teardown();
  });

  it('closes and reopens for anyone who may read, publishing only real changes', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    expect(
      dataOf<TicketDetailResponse>(
        await patch('creator', ticket._id, { isOpen: false }).expect(200),
      ).isOpen,
    ).toBe(false);
    await patch('creator', ticket._id, { isOpen: false }).expect(200);
    await patch('assignee', ticket._id, { isOpen: true }).expect(200);
    await patch('outsider', ticket._id, { isOpen: false }).expect(403);
    await waitUntil(() => events.length === 2);
    expect(events).toEqual([
      {
        type: 'ticket-status',
        ticketId: ticket._id,
        messageId: null,
        open: false,
      },
      {
        type: 'ticket-status',
        ticketId: ticket._id,
        messageId: null,
        open: true,
      },
    ]);
    expect((await stored(ticket._id))!.isOpen).toBe(true);
  });

  it('keeps the flag and the recompute consistent under parallel toggles', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    // the update is compare-and-set: a toggle that read a value another one already changed is refused with 409
    const statuses = await Promise.all(
      [true, false, true, true].map(
        async (isContributive) =>
          (await patch('staff', ticket._id, { isContributive })).status,
      ),
    );
    expect(statuses).toContain(200);
    for (const code of statuses) expect([200, 409]).toContain(code);
    await patch('staff', ticket._id, { isContributive: true }).expect(200);
    expect((await stored(ticket._id))!.isContributive).toBe(true);
    expect(new Set((await queuedUsers()).map((job) => job.userId))).toEqual(
      new Set([people.creator.id]),
    );
  });

  it('never lets staff mark their own ticket good, and refuses everyone else', async () => {
    const own = await createTicket(api, { creator: people.staffCreator.id });
    await patch('staffCreator', own._id, { isContributive: true })
      .expect(403)
      .expect(errorCode('forbidden'));
    const other = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    for (const who of ['creator', 'assignee', 'outsider'])
      await patch(who, other._id, { isContributive: true }).expect(403);
    expect((await stored(own._id))!.isContributive).toBe(false);
    expect((await stored(other._id))!.isContributive).toBe(false);
    expect(await queuedUsers()).toHaveLength(0);
  });

  it('refuses a PATCH atomically', async () => {
    const ticket = await createTicket(api, { creator: people.creator.id });
    await patch('creator', ticket._id, {
      isOpen: false,
      notes: 'sneaky',
    }).expect(403);
    expect(await stored(ticket._id)).toMatchObject({ isOpen: true, notes: '' });
    const staffTicket = await createTicket(api, {
      creator: people.staffCreator.id,
      assignees: [people.assignee.id],
    });
    await patch('staffCreator', staffTicket._id, {
      isOpen: false,
      notes: 'ok',
      isContributive: true,
    }).expect(403);
    expect(await stored(staffTicket._id)).toMatchObject({
      isOpen: true,
      notes: '',
      isContributive: false,
    });
    await patch('staff', staffTicket._id, {
      isOpen: false,
      notes: 'ok',
      assignees: ['ghost'],
    }).expect(400);
    expect(await stored(staffTicket._id)).toMatchObject({
      isOpen: true,
      notes: '',
    });
    expect((await stored(staffTicket._id))!.assignees.map(uuidStr)).toEqual([
      people.assignee.id,
    ]);
    expect(events).toEqual([]);
    expect(await queuedUsers()).toHaveLength(0);
  });

  it('lets staff reassign by username and refuses unknown or inactive users', async () => {
    const ticket = await createTicket(api, {
      creator: people.creator.id,
      assignees: [people.assignee.id],
    });
    const saved = dataOf<TicketDetailResponse>(
      await patch('staff', ticket._id, {
        assignees: ['newAssignee', 'assignee'],
      }).expect(200),
    );
    expect(saved.assignees.map((assignee) => assignee.username).sort()).toEqual(
      ['assignee', 'newAssignee'],
    );
    const bad = await patch('staff', ticket._id, {
      assignees: ['ghost', 'inactive'],
    }).expect(400);
    expect(
      (
        bad.body as {
          error: { issues: Array<{ field: string; code: string }> };
        }
      ).error.issues,
    ).toEqual([
      expect.objectContaining({ field: 'assignees', code: 'assignee_unknown' }),
    ]);
    await patch('creator', ticket._id, { assignees: [] }).expect(403);
    await patch('staff', ticket._id, { assignees: [] }).expect(200);
    expect((await stored(ticket._id))!.assignees.map(uuidStr)).toEqual([]);
  });
});
