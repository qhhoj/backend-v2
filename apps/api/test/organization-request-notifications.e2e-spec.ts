import { NotificationsRepository } from '@libs/community';
import type { User } from '@libs/database';
import type { OrganizationRequestResponse } from '../src/modules/organizations/requests/dto/organization-request.response';
import { clearRateLimits } from './contest-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('organization join request notifications', () => {
  let api: ApiTest;
  let userCount = 0;
  const post = (url: string, session: TestSession, body: object = {}) =>
    authed(api.http().post(url), session).send(body);
  const person = async (extra: Partial<User> = {}) => {
    userCount += 1;
    const user = await createUserWith(api, `joiner${userCount}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const scenario = async () => {
    const admin = await person();
    const requester = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      name: 'THPT Chuyên',
      adminIds: [admin.user._id],
    });
    const created = dataOf<OrganizationRequestResponse>(
      await post(
        organizationUrl(organization.slug, '/requests'),
        requester.session,
        { reason: 'I study here' },
      ).expect(201),
    );
    const decide = (state: 'A' | 'R') =>
      post(
        organizationUrl(organization.slug, `/requests/${created.id}/decide`),
        admin.session,
        { state },
      );
    return { admin, requester, organization, created, decide };
  };
  const inbox = (userId: string) =>
    api.notifications.find({ user: userId }).lean();

  beforeAll(async () => {
    api = await setupApiTest();
  });
  beforeEach(async () => {
    await api.notifications.deleteMany({});
    await clearRateLimits(api);
  });
  afterAll(() => api.teardown());

  it('tells the requester the request was approved, and nobody else', async () => {
    const { admin, requester, organization, created, decide } =
      await scenario();
    await decide('A').expect(200);
    const rows = await inbox(requester.user._id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'organization-request-decided',
      priority: 'normal',
      unread: true,
      path: `/organizations/${organization.slug}`,
      groupKey: `org-request:${created.id}`,
    });
    expect(rows[0].title).toContain('đã được duyệt');
    expect(rows[0].title).toContain('THPT Chuyên');
    expect(await inbox(admin.user._id)).toHaveLength(0);
  });

  it('tells the requester the request was refused', async () => {
    const { requester, decide } = await scenario();
    await decide('R').expect(200);
    const [row] = await inbox(requester.user._id);
    expect(row.title).toContain('đã bị từ chối');
  });

  it('does not notify again when the request was already decided', async () => {
    const { requester, decide } = await scenario();
    await decide('A').expect(200);
    await decide('R').expect(409);
    const rows = await inbox(requester.user._id);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
  });

  it('still decides the request when the inbox write fails', async () => {
    const { requester, created, decide } = await scenario();
    const merge = jest
      .spyOn(api.app.get(NotificationsRepository), 'merge')
      .mockRejectedValueOnce(new Error('mongo down'));
    await decide('A').expect(200);
    merge.mockRestore();
    expect(await inbox(requester.user._id)).toHaveLength(0);
    const stored = await api.organizationRequests.findById(created.id).lean();
    expect(stored?.state).toBe('A');
  });
});
