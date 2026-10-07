import type { User } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type {
  OrganizationDetailResponse,
  OrganizationListItemResponse,
} from '../src/modules/organizations/core/dto/organization.response';
import type { MemberResponse } from '../src/modules/organizations/core/dto/member.response';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('organizations', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const get = (url: string, session?: TestSession) =>
    session ? authed(api.http().get(url), session) : api.http().get(url);

  beforeAll(async () => {
    api = await setupApiTest();
    const roles: Array<[string, Partial<User>]> = [
      ['admin', {}],
      ['member', {}],
      ['outsider', {}],
      ['staff', { permissions: ['judge.edit_all_organization'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    await createOrganization(
      api,
      {
        name: 'Alpha',
        slug: 'alpha',
        about: 'raw',
        aboutHtml: '<p>raw</p>',
        adminIds: [users.admin._id],
      },
      [users.member._id],
    );
    await createOrganization(
      api,
      { name: 'Beta', slug: 'beta', isUnlisted: true },
      [users.member._id],
    );
  });
  afterAll(() => api.teardown());

  it('lists unlisted organizations only to their members and edit_all_organization', async () => {
    const slugsFor = async (session?: TestSession) =>
      dataOf<OrganizationListItemResponse[]>(
        await get('/api/internal/organizations', session).expect(200),
      ).map((item) => item.slug);
    expect(await slugsFor()).toEqual(['alpha']);
    expect(await slugsFor(sessions.outsider)).toEqual(['alpha']);
    expect(await slugsFor(sessions.member)).toEqual(['alpha', 'beta']);
    expect(await slugsFor(sessions.staff)).toEqual(['alpha', 'beta']);
  });

  it('serves an unlisted organization by its slug, case-insensitively', async () => {
    await get(organizationUrl('nope'), sessions.outsider).expect(404);
    expect(
      dataOf<OrganizationDetailResponse>(
        await get(organizationUrl('BETA'), sessions.outsider).expect(200),
      ).slug,
    ).toBe('beta');
    await get(organizationUrl('beta', '/members')).expect(200);
  });

  it('shows the raw about and the viewer facts only to whom they belong', async () => {
    const asAdmin = dataOf<OrganizationDetailResponse>(
      await get(organizationUrl('alpha'), sessions.admin).expect(200),
    );
    expect(asAdmin).toMatchObject({
      slug: 'alpha',
      aboutHtml: '<p>raw</p>',
      about: 'raw',
      viewer: { isMember: true, canAdminister: true },
    });
    expect(asAdmin.admins.map((admin) => admin.username)).toEqual(['admin']);
    const asOutsider = dataOf<OrganizationDetailResponse>(
      await get(organizationUrl('alpha'), sessions.outsider).expect(200),
    );
    expect(asOutsider.about).toBeNull();
    expect(asOutsider.viewer).toMatchObject({
      isMember: false,
      canAdminister: false,
    });
    expect(
      dataOf<OrganizationDetailResponse>(
        await get(organizationUrl('alpha')).expect(200),
      ).viewer,
    ).toBeNull();
  });

  it('lists listed members ranked like legacy ranker, page 2 continuing page 1', async () => {
    const organization = await createOrganization(api, { slug: 'ranked' });
    const points = [90, 80, 80, 80, 70];
    for (const [index, performancePoints] of points.entries())
      await createUserWith(api, `ranked${index}`, {
        organizations: [organization._id],
        performancePoints,
      });
    await createUserWith(api, 'ranked_hidden', {
      organizations: [organization._id],
      performancePoints: 100,
      isUnlisted: true,
    });
    const page = async (number: number) =>
      dataOf<MemberResponse[]>(
        await get(
          organizationUrl('ranked', `/members?pageSize=2&page=${number}`),
        ).expect(200),
      );
    expect((await page(1)).map((row) => [row.username, row.rank])).toEqual([
      ['ranked0', 1],
      ['ranked1', 2],
    ]);
    expect((await page(2)).map((row) => [row.username, row.rank])).toEqual([
      ['ranked2', 2],
      ['ranked3', 2],
    ]);
    expect((await page(3)).map((row) => [row.username, row.rank])).toEqual([
      ['ranked4', 5],
    ]);
  });

  it('sorts members by another field on request', async () => {
    const organization = await createOrganization(api, { slug: 'sorted' });
    await createUserWith(api, 'sorted_a', {
      organizations: [organization._id],
      performancePoints: 10,
      problemCount: 3,
    });
    await createUserWith(api, 'sorted_b', {
      organizations: [organization._id],
      performancePoints: 20,
      problemCount: 1,
    });
    const rows = dataOf<MemberResponse[]>(
      await get(organizationUrl('sorted', '/members?sort=problemCount')).expect(
        200,
      ),
    );
    expect(rows.map((row) => row.username)).toEqual(['sorted_a', 'sorted_b']);
    await get(organizationUrl('sorted', '/members?sort=password')).expect(400);
  });

  it('reads members through the organizations index', async () => {
    const operations = await profileQueries(api.db, () =>
      get(organizationUrl('ranked', '/members')).expect(200),
    );
    const userReads = operations.filter(
      ({ collection }) => collection === 'users',
    );
    expect(userReads.length).toBeGreaterThan(0);
    expect(
      userReads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
  });
});
