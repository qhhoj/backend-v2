import { TICKET_CANNED_REPLIES_MAX } from '@libs/community';
import { newId } from '@libs/database';
import type { User } from '@libs/database';
import type { CannedReplyResponse } from '../src/modules/tickets/canned/dto/canned-reply.response';
import { authed } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { signedIn } from './ticket-fixtures';

const BASE = '/api/internal/ticket-canned-replies';

describe('ticket canned replies', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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
    expect((await listed()).map((reply) => [reply.title, reply.body])).toEqual([
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
    await send('staff', 'patch', `/${reply._id}`, { title: null }).expect(400);
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
