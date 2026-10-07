import { getQueueToken } from '@nestjs/bullmq';
import { REDIS } from '@libs/common';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import {
  clearOrganizationPointsPending,
  ORGANIZATION_POINTS_JOB,
  ORGANIZATION_POINTS_QUEUE,
} from '@libs/community';
import { Queue as BullQueue } from 'bullmq';
import type { OrganizationPointsJob } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type { OrganizationDetailResponse } from '../src/modules/organizations/core/dto/organization.response';
import { OrganizationPointsService } from '../src/modules/organizations/core/organization-points.service';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('organization editing and membership', () => {
  let api: ApiTest;
  let queue: Queue<OrganizationPointsJob>;
  let userCount = 0;
  const post = (url: string, session: TestSession, body: object = {}) =>
    authed(api.http().post(url), session).send(body);
  const patch = (url: string, session: TestSession, body: object) =>
    authed(api.http().patch(url), session).send(body);
  const person = async (extra: Partial<User> = {}) => {
    userCount += 1;
    const user = await createUserWith(api, `member${userCount}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const membershipsOf = async (userId: string) =>
    (
      (await api.users.findById(userId, { organizations: 1 }).lean())!
        .organizations ?? []
    ).map(uuidStr);
  const queuedFor = async () =>
    (await queue.getJobs(['waiting'])).map((job) => job.data.organizationId);

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(ORGANIZATION_POINTS_QUEUE));
  });
  beforeEach(async () => {
    await queue.drain();
    const redis = api.app.get<Redis>(REDIS);
    const pending = await redis.keys('organization-points:pending:*');
    if (pending.length) await redis.del(...pending);
  });
  afterAll(() => api.teardown());

  it('creates an unlisted organization with the creator as admin, member and Org Admin', async () => {
    const group = await api.groups.create({
      name: 'Org Admin',
      permissions: ['judge.edit_organization_post'],
    });
    const { user, session } = await person({
      permissions: ['judge.add_organization'],
    });
    const created = dataOf<OrganizationDetailResponse>(
      await post('/api/internal/organizations', session, {
        name: 'A very long organization',
        slug: 'averyveryverylongslug_x',
        about: '<b>hi</b>',
        isOpen: true,
      }).expect(201),
    );
    expect(created).toMatchObject({
      slug: 'averyveryverylongslug_x',
      shortName: 'averyveryverylongslu',
      isUnlisted: true,
      isOpen: true,
      viewer: { isMember: true, canAdminister: true },
    });
    expect(created.aboutHtml).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(await membershipsOf(user._id)).toEqual([created.id]);
    expect(
      (await api.users.findById(user._id).lean())!.groups.map(uuidStr),
    ).toEqual([group._id]);
    expect(await queuedFor()).toEqual([created.id]);
  });

  it('refuses create without add_organization and a slug taken in any case', async () => {
    const { session } = await person();
    await post('/api/internal/organizations', session, {
      name: 'X',
      slug: 'nope',
    })
      .expect(403)
      .expect(errorCode('forbidden'));
    const { session: creator } = await person({
      permissions: ['judge.add_organization'],
    });
    await createOrganization(api, { slug: 'taken' });
    const response = await post('/api/internal/organizations', creator, {
      name: 'X',
      slug: 'TAKEN',
    }).expect(400);
    expect(
      (response.body as { error: { fields: Record<string, string[]> } }).error
        .fields.slug,
    ).toBeDefined();
    await post('/api/internal/organizations', creator, {
      name: 'X',
      slug: '9lives',
    }).expect(400);
  });

  it('caps admin roles at three unless the acting user has spam_organization', async () => {
    const { user, session } = await person({
      permissions: ['judge.add_organization'],
    });
    for (let index = 0; index < 3; index++)
      await createOrganization(api, { adminIds: [user._id] });
    await post('/api/internal/organizations', session, {
      name: 'Fourth',
      slug: 'fourth',
    }).expect(403);
    await api.users.updateOne(
      { _id: user._id },
      { $push: { permissions: 'judge.spam_organization' } },
    );
    await post('/api/internal/organizations', session, {
      name: 'Fourth',
      slug: 'fourth',
    }).expect(201);
    const { user: busy } = await person();
    for (let index = 0; index < 3; index++)
      await createOrganization(api, { adminIds: [busy._id] });
    const { user: owner, session: ownerSession } = await person();
    const organization = await createOrganization(api, {
      adminIds: [owner._id],
    });
    await patch(organizationUrl(organization.slug), ownerSession, {
      adminIds: [owner._id, busy._id],
    }).expect(400);
  });

  it('lets only staff change isUnlisted, slots and shortName; admins may change isOpen', async () => {
    const { user: owner, session: ownerSession } = await person();
    const organization = await createOrganization(api, {
      adminIds: [owner._id],
    });
    await patch(organizationUrl(organization.slug), ownerSession, {
      isUnlisted: true,
    }).expect(403);
    await patch(organizationUrl(organization.slug), ownerSession, {
      isOpen: false,
      name: 'Renamed',
    }).expect(200);
    const { session: staff } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    await patch(organizationUrl(organization.slug), staff, {
      isUnlisted: true,
      slots: 2,
      shortName: 'short',
    }).expect(200);
    expect(
      await api.organizations.findById(organization._id).lean(),
    ).toMatchObject({
      name: 'Renamed',
      isOpen: false,
      isUnlisted: true,
      slots: 2,
      shortName: 'short',
    });
    const { session: outsider } = await person();
    await patch(organizationUrl(organization.slug), outsider, {
      name: 'Hijack',
    }).expect(403);
    await patch(organizationUrl('missing'), outsider, {
      name: 'Hijack',
    }).expect(404);
  });

  it('refuses null on every field but slots and leaves the row unchanged', async () => {
    const { user: owner, session } = await person();
    const organization = await createOrganization(api, {
      adminIds: [owner._id],
      about: 'kept',
    });
    const response = await patch(organizationUrl(organization.slug), session, {
      name: null,
      slug: null,
      about: null,
      isOpen: null,
    }).expect(400);
    expect(
      Object.keys(
        (response.body as { error: { fields: object } }).error.fields,
      ).sort(),
    ).toEqual(['about', 'isOpen', 'name', 'slug']);
    expect(
      await api.organizations.findById(organization._id).lean(),
    ).toMatchObject({
      slug: organization.slug,
      name: organization.name,
      about: 'kept',
      isOpen: true,
    });
    const { session: staff } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    await patch(organizationUrl(organization.slug), staff, {
      slots: null,
    }).expect(200);
  });

  it('renames a slug: taken in any case is 400, a case change of its own is 200', async () => {
    const { user: owner, session } = await person();
    await createOrganization(api, { slug: 'rename-beta' });
    const organization = await createOrganization(api, {
      adminIds: [owner._id],
      slug: 'rename-alpha',
    });
    const response = await patch(organizationUrl('rename-alpha'), session, {
      slug: 'RENAME-BETA',
    }).expect(400);
    expect(
      (response.body as { error: { fields: Record<string, string[]> } }).error
        .fields.slug,
    ).toBeDefined();
    const renamed = dataOf<OrganizationDetailResponse>(
      await patch(organizationUrl('rename-alpha'), session, {
        slug: 'Rename-Alpha',
      }).expect(200),
    );
    expect(renamed.slug).toBe('Rename-Alpha');
    expect(
      (await api.organizations.findById(organization._id).lean())!.slug,
    ).toBe('Rename-Alpha');
  });

  it('makes new admins members past the open-organization cap and keeps removed ones as members', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { user: newcomer } = await person();
    for (let index = 0; index < 3; index++)
      await createOrganization(api, {}, [newcomer._id]);
    const organization = await createOrganization(api, {
      adminIds: [owner._id],
    });
    await patch(organizationUrl(organization.slug), ownerSession, {
      adminIds: [owner._id, newcomer._id],
    }).expect(200);
    expect(await membershipsOf(newcomer._id)).toContain(organization._id);
    await patch(organizationUrl(organization.slug), ownerSession, {
      adminIds: [owner._id],
    }).expect(200);
    expect(await membershipsOf(newcomer._id)).toContain(organization._id);
    await patch(organizationUrl(organization.slug), ownerSession, {
      adminIds: [],
    }).expect(400);
  });

  it('joins open organizations up to three, never a private one, never twice; private ones do not count', async () => {
    const { user, session } = await person();
    const [first, second, third, fourth] = [
      await createOrganization(api),
      await createOrganization(api),
      await createOrganization(api),
      await createOrganization(api),
    ];
    const closed = await createOrganization(api, { isOpen: false }, [user._id]);
    await post(organizationUrl(first.slug, '/join'), session).expect(204);
    await post(organizationUrl(first.slug, '/join'), session).expect(409);
    await post(organizationUrl(second.slug, '/join'), session).expect(204);
    await post(organizationUrl(third.slug, '/join'), session).expect(204);
    await post(organizationUrl(fourth.slug, '/join'), session).expect(409);
    expect(await membershipsOf(user._id)).toEqual([
      closed._id,
      first._id,
      second._id,
      third._id,
    ]);
    const { session: other } = await person();
    await post(organizationUrl(closed.slug, '/join'), other).expect(409);
    expect((await queuedFor()).sort()).toEqual(
      [first._id, second._id, third._id].sort(),
    );
  });

  it('lets only one of five parallel joins through at the open-organization cap', async () => {
    const { user, session } = await person();
    await createOrganization(api, {}, [user._id]);
    await createOrganization(api, {}, [user._id]);
    const targets = await Promise.all(
      Array.from({ length: 5 }, () => createOrganization(api)),
    );
    const statuses = (
      await Promise.all(
        targets.map((target) =>
          post(organizationUrl(target.slug, '/join'), session),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);
    expect(await membershipsOf(user._id)).toHaveLength(3);
  });

  it('leaves and kicks members, never admins; only administrators kick', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { user: member, session: memberSession } = await person();
    const { user: other } = await person();
    const organization = await createOrganization(
      api,
      { adminIds: [owner._id] },
      [member._id, other._id],
    );
    await post(
      organizationUrl(organization.slug, '/leave'),
      ownerSession,
    ).expect(409);
    await post(organizationUrl(organization.slug, '/kick'), memberSession, {
      userId: other._id,
    }).expect(403);
    await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
      userId: owner._id,
    }).expect(409);
    await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
      userId: other._id,
    }).expect(204);
    await post(organizationUrl(organization.slug, '/kick'), ownerSession, {
      userId: other._id,
    }).expect(409);
    await post(
      organizationUrl(organization.slug, '/leave'),
      memberSession,
    ).expect(204);
    await post(
      organizationUrl(organization.slug, '/leave'),
      memberSession,
    ).expect(409);
    expect(await membershipsOf(member._id)).toEqual([]);
    const { session: staff } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const { user: third } = await person();
    await api.users.updateOne(
      { _id: third._id },
      { $push: { organizations: organization._id } },
    );
    await post(organizationUrl(organization.slug, '/kick'), staff, {
      userId: third._id,
    }).expect(204);
    // Leave, kick and kick collapse into the one waiting job.
    expect(await queuedFor()).toEqual([organization._id]);
    // The worker clears the flag when it starts, so a change meanwhile queues the next recompute.
    await clearOrganizationPointsPending(
      api.app.get<Redis>(REDIS),
      organization._id,
    );
    const { user: fourth } = await person();
    await api.users.updateOne(
      { _id: fourth._id },
      { $push: { organizations: organization._id } },
    );
    await post(organizationUrl(organization.slug, '/kick'), staff, {
      userId: fourth._id,
    }).expect(204);
    expect(await queuedFor()).toEqual([organization._id, organization._id]);
  });

  it('gives exactly one of eight parallel creates the last admin role', async () => {
    const { user, session } = await person({
      permissions: ['judge.add_organization'],
    });
    for (let index = 0; index < 2; index++)
      await createOrganization(api, { adminIds: [user._id] });
    const statuses = (
      await Promise.all(
        Array.from({ length: 8 }, (_unused, index) => `parallel${index}`).map(
          (slug) =>
            post('/api/internal/organizations', session, { name: slug, slug }),
        ),
      )
    ).map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(
      statuses.filter((status) => status === 409 || status === 403),
    ).toHaveLength(7);
    expect(await api.organizations.countDocuments({ adminIds: user._id })).toBe(
      3,
    );
  });

  it('queues one recompute job per distinct organization', async () => {
    const points = api.app.get(OrganizationPointsService);
    const addBulk = jest.spyOn(BullQueue.prototype, 'addBulk');
    try {
      await points.refresh(['org-a', 'org-b', 'org-a']);
      await points.refresh([]);
      const queued = addBulk.mock.calls
        .flatMap(([jobs]) => jobs)
        .filter((job) => job.name === ORGANIZATION_POINTS_JOB)
        .map((job) => (job.data as OrganizationPointsJob).organizationId);
      expect(queued).toEqual(['org-a', 'org-b']);
    } finally {
      addBulk.mockRestore();
    }
  });
});
