import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type { OrganizationDetailResponse } from '../src/modules/organizations/core/dto/organization.response';
import type { OrganizationRequestResponse } from '../src/modules/organizations/requests/dto/organization-request.response';
import { clearRateLimits } from './contest-fixtures';
import { OrganizationPointsService } from '../src/modules/organizations/core/organization-points.service';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('organization join requests', () => {
  afterEach(() => jest.restoreAllMocks());
  let api: ApiTest;
  let queue: Queue<OrganizationPointsJob>;
  let userCount = 0;
  const post = (url: string, session: TestSession, body: object = {}) =>
    authed(api.http().post(url), session).send(body);
  const get = (url: string, session: TestSession) =>
    authed(api.http().get(url), session);
  const person = async (extra: Partial<User> = {}) => {
    userCount += 1;
    const user = await createUserWith(api, `requester${userCount}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const request = async (slug: string, session: TestSession) =>
    dataOf<OrganizationRequestResponse>(
      await post(organizationUrl(slug, '/requests'), session, {
        reason: 'I study here',
      }).expect(201),
    );
  const decide = (
    slug: string,
    id: string,
    session: TestSession,
    state: 'A' | 'R',
  ) =>
    post(organizationUrl(slug, `/requests/${id}/decide`), session, { state });
  const membershipsOf = async (userId: string) =>
    (await api.users
      .findById(userId, { organizations: 1 })
      .lean())!.organizations.map(uuidStr);

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(ORGANIZATION_POINTS_QUEUE));
  });
  beforeEach(async () => {
    await queue.drain();
    await clearRateLimits(api);
  });
  afterAll(() => api.teardown());

  it('takes a request, shows it to the requester and administrators, and approves it into membership', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { user, session } = await person();
    const { session: outsider } = await person();
    const { user: staff, session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const organization = await createOrganization(api, {
      isOpen: false,
      isUnlisted: true,
      adminIds: [owner._id],
    });
    const created = await request(organization.slug, session);
    expect(created).toMatchObject({
      state: 'P',
      reason: 'I study here',
      username: user.username,
      decidedBy: null,
    });
    expect(
      dataOf<OrganizationDetailResponse>(
        await get(organizationUrl(organization.slug), session).expect(200),
      ).viewer?.pendingRequestId,
    ).toBe(created.id);
    await get(
      organizationUrl(organization.slug, `/requests/${created.id}`),
      session,
    ).expect(200);
    await get(
      organizationUrl(organization.slug, `/requests/${created.id}`),
      outsider,
    ).expect(403);
    await get(organizationUrl(organization.slug, '/requests'), session).expect(
      403,
    );
    expect(
      dataOf<OrganizationRequestResponse[]>(
        await get(
          organizationUrl(organization.slug, '/requests'),
          ownerSession,
        ).expect(200),
      ).map((row) => row.id),
    ).toEqual([created.id]);
    const approved = dataOf<OrganizationRequestResponse>(
      await decide(organization.slug, created.id, staffSession, 'A').expect(
        200,
      ),
    );
    expect(approved).toMatchObject({ state: 'A', decidedBy: staff._id });
    expect(approved.decidedAt).not.toBeNull();
    expect(await membershipsOf(user._id)).toEqual([organization._id]);
    expect(
      (await queue.getJobs(['waiting'])).map((job) => job.data.organizationId),
    ).toEqual([organization._id]);
    await decide(organization.slug, created.id, ownerSession, 'R').expect(409);
    expect(
      dataOf<OrganizationRequestResponse[]>(
        await get(
          organizationUrl(organization.slug, '/requests?state=A'),
          ownerSession,
        ).expect(200),
      ),
    ).toHaveLength(1);
  });

  it('keeps one pending request per user and organization; a rejected one allows another', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { session } = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const first = await request(organization.slug, session);
    await post(organizationUrl(organization.slug, '/requests'), session, {
      reason: 'again',
    }).expect(409);
    await decide(organization.slug, first.id, ownerSession, 'R').expect(200);
    await request(organization.slug, session);
  });

  it('refuses requests to open organizations and from members', async () => {
    const { user, session } = await person();
    const open = await createOrganization(api, { isOpen: true });
    const closed = await createOrganization(api, { isOpen: false }, [user._id]);
    await post(organizationUrl(open.slug, '/requests'), session, {
      reason: 'x',
    }).expect(409);
    await post(organizationUrl(closed.slug, '/requests'), session, {
      reason: 'x',
    }).expect(409);
    await post(organizationUrl(closed.slug, '/requests'), session, {
      reason: '',
    }).expect(400);
  });

  it('approves into a private organization past the open-organization cap, never twice, never past slots', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { user: busy, session: busySession } = await person();
    for (let index = 0; index < 3; index++)
      await createOrganization(api, { isOpen: true }, [busy._id]);
    const organization = await createOrganization(api, {
      isOpen: false,
      slots: 2,
      adminIds: [owner._id],
    });
    await decide(
      organization.slug,
      (await request(organization.slug, busySession)).id,
      ownerSession,
      'A',
    ).expect(200);
    expect(await membershipsOf(busy._id)).toContain(organization._id);
    const { user: late, session: lateSession } = await person();
    const pending = await request(organization.slug, lateSession);
    await decide(organization.slug, pending.id, ownerSession, 'A').expect(409);
    expect(await membershipsOf(late._id)).toEqual([]);
    expect(
      (await api.organizationRequests.findById(pending.id).lean())!.state,
    ).toBe('P');
    const unlimited = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const { user: joined, session: joinedSession } = await person();
    const already = await request(unlimited.slug, joinedSession);
    await api.users.updateOne(
      { _id: joined._id },
      { $push: { organizations: unlimited._id } },
    );
    // A member whose request is still pending: a retried approval just records the decision.
    const retried = dataOf<OrganizationRequestResponse>(
      await decide(unlimited.slug, already.id, ownerSession, 'A').expect(200),
    );
    expect(retried.state).toBe('A');
    expect(await membershipsOf(joined._id)).toEqual([unlimited._id]);
  });

  it('never approves past slots under parallel decisions', async () => {
    const { user: owner, session: ownerSession } = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      slots: 2,
      adminIds: [owner._id],
    });
    const requests = [];
    for (let index = 0; index < 10; index++)
      requests.push(await request(organization.slug, (await person()).session));
    const statuses = (
      await Promise.all(
        requests.map((row) =>
          decide(organization.slug, row.id, ownerSession, 'A'),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(9);
    expect(
      await api.users.countDocuments({ organizations: organization._id }),
    ).toBe(2);
  });

  it('limits join requests to five per hour per user', async () => {
    const { session } = await person();
    const organizations = await Promise.all(
      Array.from({ length: 6 }, () =>
        createOrganization(api, { isOpen: false }),
      ),
    );
    for (const organization of organizations.slice(0, 5))
      await request(organization.slug, session);
    await post(organizationUrl(organizations[5].slug, '/requests'), session, {
      reason: 'x',
    }).expect(429);
  });
  it('gives the rate-limit hit back for a refused duplicate', async () => {
    const { session } = await person();
    const organizations = await Promise.all(
      Array.from({ length: 5 }, () =>
        createOrganization(api, { isOpen: false }),
      ),
    );
    await request(organizations[0].slug, session);
    for (let attempt = 0; attempt < 5; attempt++)
      await post(organizationUrl(organizations[0].slug, '/requests'), session, {
        reason: 'again',
      }).expect(409);
    for (const organization of organizations.slice(1))
      await request(organization.slug, session);
  });
  it('never adds a member for a request that was already rejected', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { user, session } = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const created = await request(organization.slug, session);
    await decide(organization.slug, created.id, ownerSession, 'R').expect(200);
    await decide(organization.slug, created.id, ownerSession, 'A').expect(409);
    expect(await membershipsOf(user._id)).toEqual([]);
  });

  it('answers a duplicate with 409 even when the hourly limit is used up', async () => {
    const { session } = await person();
    const organizations = await Promise.all(
      Array.from({ length: 5 }, () =>
        createOrganization(api, { isOpen: false }),
      ),
    );
    for (const organization of organizations)
      await request(organization.slug, session);
    await post(organizationUrl(organizations[0].slug, '/requests'), session, {
      reason: 'again',
    }).expect(409);
  });

  it('rejects in parallel without the approval lock, and rereads slots under it', async () => {
    const { user: owner, session: ownerSession } = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const requests = [];
    for (let index = 0; index < 6; index++)
      requests.push(await request(organization.slug, (await person()).session));
    const statuses = (
      await Promise.all(
        requests.map((row) =>
          decide(organization.slug, row.id, ownerSession, 'R'),
        ),
      )
    ).map((response) => response.status);
    expect(statuses).toEqual(requests.map(() => 200));
    const pending = await request(organization.slug, (await person()).session);
    await api.organizations.updateOne({ _id: organization._id }, { slots: 1 });
    await decide(organization.slug, pending.id, ownerSession, 'A').expect(409);
  });

  it('records an approval and answers 200 when the points refresh fails', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { user, session } = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const created = await request(organization.slug, session);
    jest
      .spyOn(api.app.get(OrganizationPointsService), 'refresh')
      .mockRejectedValueOnce(new Error('redis down'));
    const approved = dataOf<OrganizationRequestResponse>(
      await decide(organization.slug, created.id, ownerSession, 'A').expect(
        200,
      ),
    );
    expect(approved.state).toBe('A');
    expect(await membershipsOf(user._id)).toEqual([organization._id]);
  });

  it('lets edit_all_organization list and read, and keeps other organizations admins out', async () => {
    const { user: ownerA } = await person();
    const { session: ownerBSession, user: ownerB } = await person();
    const { session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const { session } = await person();
    const organizationA = await createOrganization(api, {
      isOpen: false,
      adminIds: [ownerA._id],
    });
    const organizationB = await createOrganization(api, {
      isOpen: false,
      adminIds: [ownerB._id],
    });
    const created = await request(organizationA.slug, session);
    expect(
      dataOf<OrganizationRequestResponse[]>(
        await get(
          organizationUrl(organizationA.slug, '/requests'),
          staffSession,
        ).expect(200),
      ).map((row) => row.id),
    ).toEqual([created.id]);
    await get(
      organizationUrl(organizationA.slug, `/requests/${created.id}`),
      staffSession,
    ).expect(200);
    await get(
      organizationUrl(organizationA.slug, '/requests'),
      ownerBSession,
    ).expect(403);
    await get(
      organizationUrl(organizationA.slug, `/requests/${created.id}`),
      ownerBSession,
    ).expect(403);
    await decide(organizationA.slug, created.id, ownerBSession, 'R').expect(
      403,
    );
    await get(
      organizationUrl(organizationB.slug, `/requests/${created.id}`),
      ownerBSession,
    ).expect(404);
    await decide(organizationB.slug, created.id, ownerBSession, 'R').expect(
      404,
    );
  });

  it('answers 400 for malformed list, decide and create input', async () => {
    const { user: owner, session: ownerSession } = await person();
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const created = await request(organization.slug, (await person()).session);
    await get(
      organizationUrl(organization.slug, '/requests?state=X'),
      ownerSession,
    ).expect(400);
    await get(
      organizationUrl(organization.slug, '/requests?page=abc'),
      ownerSession,
    ).expect(400);
    await decide(
      organization.slug,
      created.id,
      ownerSession,
      'P' as 'A',
    ).expect(400);
    const { session } = await person();
    await post(organizationUrl(organization.slug, '/requests'), session, {
      reason: 'x'.repeat(4097),
    }).expect(400);
    await post(organizationUrl(organization.slug, '/requests'), session, {
      reason: '   ',
    }).expect(400);
  });
});
