import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { newId } from '@libs/database';
import type { User } from '@libs/database';
import type { OrganizationRequestResponse } from '../src/modules/organizations/requests/dto/organization-request.response';
import { clearRateLimits } from './contest-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { profileQueries } from '@libs/database/testing';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const QUEUE_URL = '/api/internal/admin/organization-requests';

describe('organization request queue', () => {
  let api: ApiTest;
  let queue: Queue<OrganizationPointsJob>;
  let userCount = 0;
  const post = (url: string, session: TestSession, body: object = {}) =>
    authed(api.http().post(url), session).send(body);
  const get = (url: string, session?: TestSession) =>
    session ? authed(api.http().get(url), session) : api.http().get(url);
  const person = async (extra: Partial<User> = {}) => {
    userCount += 1;
    const user = await createUserWith(api, `queuer${userCount}`, extra);
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
  const queueRows = async (query: string, session: TestSession) =>
    dataOf<OrganizationRequestResponse[]>(
      await get(`${QUEUE_URL}${query}`, session).expect(200),
    );

  beforeAll(async () => {
    api = await setupApiTest();
    queue = api.app.get(getQueueToken(ORGANIZATION_POINTS_QUEUE));
  });
  beforeEach(async () => {
    await queue.drain();
    await clearRateLimits(api);
  });
  afterAll(() => api.teardown());

  it('lists pending requests across organizations newest first, naming each organization and requester', async () => {
    const { user: ownerA } = await person();
    const { user: ownerB } = await person();
    const { user: staffUser, session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const { user: firstRequester, session: firstSession } = await person();
    const { user: secondRequester, session: secondSession } = await person();
    const { user: thirdRequester, session: thirdSession } = await person();
    const organizationA = await createOrganization(api, {
      isOpen: false,
      adminIds: [ownerA._id],
    });
    const organizationB = await createOrganization(api, {
      isOpen: false,
      adminIds: [ownerB._id],
    });
    const first = await request(organizationA.slug, firstSession);
    const second = await request(organizationB.slug, secondSession);
    const approved = await request(organizationB.slug, thirdSession);
    await decide(organizationB.slug, approved.id, staffSession, 'A').expect(
      200,
    );
    expect(await queueRows('', staffSession)).toMatchObject([
      {
        id: second.id,
        organizationSlug: organizationB.slug,
        username: secondRequester.username,
        state: 'P',
      },
      {
        id: first.id,
        organizationSlug: organizationA.slug,
        username: firstRequester.username,
        state: 'P',
      },
    ]);
    expect(await queueRows('?state=P', staffSession)).toHaveLength(2);
    expect(await queueRows('?state=A', staffSession)).toMatchObject([
      {
        id: approved.id,
        organizationSlug: organizationB.slug,
        username: thirdRequester.username,
        state: 'A',
        decidedBy: staffUser._id,
      },
    ]);
    expect(await queueRows('?state=R', staffSession)).toEqual([]);
  });

  it('serves the queue from the state index, newest first, with no in-memory sort', async () => {
    const { session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const operations = await profileQueries(api.db, () =>
      queueRows('?state=P', staffSession),
    );
    const reads = operations.filter(
      ({ collection }) => collection === 'organizationRequests',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.some(({ planSummary }) =>
        planSummary.includes('IXSCAN { state: 1, _id: -1 }'),
      ),
    ).toBe(true);
    expect(
      reads.every(
        ({ planSummary, hasSortStage }) =>
          !planSummary.includes('COLLSCAN') && !hasSortStage,
      ),
    ).toBe(true);
  });

  it('pages 50 rows at a time, newest first', async () => {
    await api.organizationRequests.deleteMany({ state: 'R' });
    const { user: owner, session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const ids = Array.from({ length: 51 }, () => newId()).sort();
    await api.organizationRequests.insertMany(
      ids.map((id) => ({
        _id: id,
        organization: organization._id,
        user: owner._id,
        state: 'R',
        reason: 'bulk',
      })),
      { ordered: true },
    );
    const firstPage = await queueRows('?state=R', staffSession);
    const secondPage = await queueRows('?state=R&page=2', staffSession);
    expect(firstPage).toHaveLength(50);
    expect(secondPage.map((row) => row.id)).toEqual([ids[0]]);
    expect(firstPage[0].id).toBe(ids[50]);
    await api.organizationRequests.deleteMany({ state: 'R' });
  });

  it('refuses the queue to organization administrators, requesters and anonymous visitors', async () => {
    const { user: owner, session: ownerSession } = await person();
    const { session: requesterSession } = await person();
    await createOrganization(api, { isOpen: false, adminIds: [owner._id] });
    await get(QUEUE_URL, ownerSession).expect(403);
    await get(QUEUE_URL, requesterSession).expect(403);
    await get(QUEUE_URL).expect(401);
  });

  it('answers 400 for an unknown state', async () => {
    const { session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    await get(`${QUEUE_URL}?state=X`, staffSession).expect(400);
  });

  it('lets edit_all_organization decide a request in an organization it does not administer', async () => {
    const { user: owner } = await person();
    const { session: requesterSession } = await person();
    const { session: staffSession } = await person({
      permissions: ['judge.edit_all_organization'],
    });
    const organization = await createOrganization(api, {
      isOpen: false,
      adminIds: [owner._id],
    });
    const pending = await request(organization.slug, requesterSession);
    await decide(organization.slug, pending.id, staffSession, 'R').expect(200);
    expect(
      (await queueRows('', staffSession)).map((row) => row.id),
    ).not.toContain(pending.id);
  });
});
