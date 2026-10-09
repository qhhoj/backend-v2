import { NotificationsService } from '@libs/community';
import type { NotificationDraft } from '@libs/community';
import { NOTIFICATION_KINDS } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type {
  NotificationResponse,
  UnreadCountResponse,
} from '../src/modules/notifications/core/dto/notification.response';
import { clearRateLimits } from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { sessionCookie, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const INBOX = '/api/internal/notifications';
const minute = (index: number) => new Date(Date.UTC(2026, 9, 9, 10, index));

describe('notification inbox', () => {
  let api: ApiTest;
  let notifications: NotificationsService;
  const people: Record<string, { id: string; session: TestSession }> = {};
  const draft = (
    groupKey: string,
    overrides: Partial<NotificationDraft> = {},
  ): NotificationDraft => ({
    kind: 'ticket-message',
    title: `Title ${groupKey}`,
    body: 'body',
    path: '/tickets/1',
    priority: 'normal',
    groupKey,
    ...overrides,
  });
  const notify = (
    who: string,
    groupKey: string,
    index: number,
    overrides: Partial<NotificationDraft> = {},
  ) =>
    notifications.notify(
      [people[who].id],
      draft(groupKey, overrides),
      minute(index),
    );
  const get = (who: string, path = '') =>
    authed(api.http().get(`${INBOX}${path}`), people[who].session);
  const post = (who: string, path: string) =>
    authed(api.http().post(`${INBOX}${path}`), people[who].session);
  /** The wire error of a failed call: its code and the codes of its field issues. */
  const errorOf = (response: { body: unknown }) => {
    const { error } = response.body as {
      error: { code: string; issues?: { field: string; code: string }[] };
    };
    return { code: error.code, issues: error.issues ?? [] };
  };
  const items = async (who: string, query = '') =>
    dataOf<NotificationResponse[]>(await get(who, query).expect(200));
  const titles = async (who: string, query = '') =>
    (await items(who, query)).map((item) => item.title);
  const unreadOf = async (who: string) =>
    api.notifications.countDocuments({ user: people[who].id, unread: true });

  beforeAll(async () => {
    api = await setupApiTest();
    notifications = api.app.get(NotificationsService);
    for (const [name, extra] of [
      ['alice', {}],
      ['bob', {}],
      ['root', { isSuperuser: true }],
    ] as const) {
      const user = await createUserWith(api, name, extra);
      people[name] = { id: user._id, session: await loginAs(api, user._id) };
    }
  });
  beforeEach(async () => {
    await api.notifications.deleteMany({});
    await clearRateLimits(api);
  });
  afterAll(() => api.teardown());

  it('lists the newest activity first, and a repeated event moves its row to the top', async () => {
    await notify('alice', 'a', 1);
    await notify('alice', 'b', 2);
    expect(await titles('alice')).toEqual(['Title b', 'Title a']);
    await notify('alice', 'a', 3, { title: 'Title a again' });
    const page = await items('alice');
    expect(page.map((item) => [item.title, item.count])).toEqual([
      ['Title a again', 2],
      ['Title b', 1],
    ]);
  });

  it('lists only the signed-in users own rows', async () => {
    await notify('alice', 'a', 1);
    await notify('bob', 'b', 2);
    expect(await titles('alice')).toEqual(['Title a']);
    expect(await titles('bob')).toEqual(['Title b']);
  });

  it('filters by state and priority and reports the total', async () => {
    await notify('alice', 'normal-unread', 1);
    await notify('alice', 'high-unread', 2, { priority: 'high' });
    await notify('alice', 'read-one', 3);
    await api.notifications.updateOne(
      { user: people.alice.id, groupKey: 'read-one' },
      { $set: { unread: false, readAt: minute(4) } },
    );
    expect(await titles('alice', '?state=unread')).toEqual([
      'Title high-unread',
      'Title normal-unread',
    ]);
    expect(await titles('alice', '?state=read')).toEqual(['Title read-one']);
    expect(await titles('alice', '?state=unread&priority=high')).toEqual([
      'Title high-unread',
    ]);
    const response = await get('alice', '?state=all').expect(200);
    expect((response.body as { meta: { total: number } }).meta.total).toBe(3);
  });

  it('filters by one kind or several repeated kinds, keeps the other filters, and totals only the matching rows', async () => {
    await notify('alice', 'new', 1, { kind: 'ticket-new' });
    await notify('alice', 'message', 2, { kind: 'ticket-message' });
    await notify('alice', 'announcement', 3, { kind: 'contest-announcement' });
    await notify('bob', 'bobs', 4, { kind: 'ticket-new' });
    expect(await titles('alice', '?kind=ticket-new')).toEqual(['Title new']);
    expect(
      await titles('alice', '?kind=ticket-new&kind=contest-announcement'),
    ).toEqual(['Title announcement', 'Title new']);
    await api.notifications.updateOne(
      { user: people.alice.id, groupKey: 'new' },
      { $set: { unread: false, readAt: minute(5) } },
    );
    expect(
      await titles(
        'alice',
        '?state=unread&kind=ticket-new&kind=ticket-message',
      ),
    ).toEqual(['Title message']);
    const response = await get(
      'alice',
      '?kind=ticket-new&kind=ticket-message',
    ).expect(200);
    expect((response.body as { meta: { total: number } }).meta.total).toBe(2);
  });

  it('refuses an unknown kind, an empty kind and more kinds than exist', async () => {
    const bogus = errorOf(await get('alice', '?kind=bogus').expect(400));
    expect(bogus.issues).toEqual([
      expect.objectContaining({ field: 'kind', code: 'is_in' }),
    ]);
    const empty = errorOf(await get('alice', '?kind=').expect(400));
    expect(empty.issues).toEqual([
      expect.objectContaining({ field: 'kind', code: 'is_in' }),
    ]);
    const tooMany = Array.from(
      { length: NOTIFICATION_KINDS.length + 1 },
      () => 'kind=ticket-new',
    ).join('&');
    const many = errorOf(await get('alice', `?${tooMany}`).expect(400));
    expect(many.issues).toEqual([
      expect.objectContaining({ field: 'kind', code: 'array_max_size' }),
    ]);
  });

  it('counts only unread rows and lets the browser cache the count for 15 seconds', async () => {
    await notify('alice', 'a', 1);
    await notify('alice', 'b', 2);
    await api.notifications.updateOne(
      { user: people.alice.id, groupKey: 'b' },
      { $set: { unread: false } },
    );
    const response = await get('alice', '/unread-count').expect(200);
    expect(dataOf<UnreadCountResponse>(response)).toEqual({ count: 1 });
    expect(response.headers['cache-control']).toBe('private, max-age=15');
  });

  it('marks a row read once, answering 204 again on a repeat, and the next event opens a fresh row', async () => {
    await notify('alice', 'a', 1);
    const [row] = await items('alice');
    await post('alice', `/${row.id}/read`).expect(204);
    await post('alice', `/${row.id}/read`).expect(204);
    expect(await unreadOf('alice')).toBe(0);
    const stored = await api.notifications
      .findOne({ user: people.alice.id })
      .lean();
    expect(stored?.readAt).toBeInstanceOf(Date);
    await notify('alice', 'a', 5);
    expect(
      (await items('alice')).map((item) => [item.unread, item.count]),
    ).toEqual([
      [true, 1],
      [false, 1],
    ]);
  });

  it('answers 404 for another users row, an unknown id and a malformed id, and leaves the row unread', async () => {
    await notify('bob', 'b', 1);
    const [bobsRow] = await items('bob');
    const refused = [
      await post('alice', `/${bobsRow.id}/read`).expect(404),
      await post('alice', '/00000000-0000-7000-8000-000000000000/read').expect(
        404,
      ),
      await post('alice', '/not-a-uuid/read').expect(404),
    ].map(errorOf);
    expect(refused.map((error) => error.code)).toEqual([
      'not_found',
      'not_found',
      'not_found',
    ]);
    expect(await unreadOf('bob')).toBe(1);
  });

  it('reads all of the callers rows and nobody elses', async () => {
    await notify('alice', 'a', 1);
    await notify('alice', 'b', 2);
    await notify('bob', 'c', 3);
    await post('alice', '/read-all').expect(204);
    expect(await unreadOf('alice')).toBe(0);
    expect(await unreadOf('bob')).toBe(1);
  });

  it('limits read-all to 30 a minute per user', async () => {
    for (let call = 0; call < 30; call += 1)
      await post('alice', '/read-all').expect(204);
    expect(errorOf(await post('alice', '/read-all').expect(429)).code).toBe(
      'rate_limited',
    );
    await post('bob', '/read-all').expect(204);
  });

  describe('while a superuser impersonates', () => {
    let session: TestSession;
    beforeAll(async () => {
      const { id, session: created } = await api.sessions.create({
        userId: people.alice.id,
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: people.root.id,
      });
      session = { cookie: sessionCookie(id), csrf: created.csrf };
    });

    it('reads the inbox but its writes are 204 no-ops', async () => {
      await notify('alice', 'a', 1);
      await notify('alice', 'b', 2);
      const asAlice = (path: string, method: 'get' | 'post') =>
        authed(api.http()[method](`${INBOX}${path}`), session);
      const listed = dataOf<NotificationResponse[]>(
        await asAlice('', 'get').expect(200),
      );
      expect(listed).toHaveLength(2);
      await asAlice(`/${listed[0].id}/read`, 'post').expect(204);
      await asAlice('/read-all', 'post').expect(204);
      expect(await unreadOf('alice')).toBe(2);
    });
  });

  it('needs a signed-in user for every route', async () => {
    await api.http().get(INBOX).expect(401);
    await api.http().get(`${INBOX}/unread-count`).expect(401);
    await api.http().post(`${INBOX}/read-all`).expect(401);
    await api
      .http()
      .post(`${INBOX}/00000000-0000-7000-8000-000000000000/read`)
      .expect(401);
  });

  it('refuses an unknown state, priority or page', async () => {
    const codes = async (query: string) =>
      errorOf(await get('alice', query).expect(400)).issues.map(
        ({ field, code }) => [field, code],
      );
    expect(await codes('?state=bogus')).toEqual([['state', 'is_in']]);
    expect(await codes('?priority=urgent')).toEqual([['priority', 'is_in']]);
    expect(await codes('?page=0')).toEqual([['page', 'min']]);
  });

  it('serves every list from an index: no collection scan, no sort stage, a page of documents', async () => {
    for (let index = 0; index < 25; index += 1)
      await notify('alice', `g${index}`, index, {
        priority: index % 2 ? 'high' : 'normal',
      });
    const operations = await profileQueries(api.db, async () => {
      for (const query of [
        '',
        '?state=unread',
        '?state=read',
        '?state=unread&priority=high',
        '?kind=ticket-message&kind=ticket-new',
      ])
        await get('alice', query).expect(200);
      await get('alice', '/unread-count').expect(200);
    });
    const reads = operations.filter(
      ({ collection, operation }) =>
        collection === 'notifications' && operation === 'query',
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.planSummary).toContain('IXSCAN');
      expect(read.planSummary).not.toContain('COLLSCAN');
      expect(read.hasSortStage).toBe(false);
    }
    expect(
      Math.max(...reads.map((read) => read.docsExamined)),
    ).toBeLessThanOrEqual(25);
  });
});
