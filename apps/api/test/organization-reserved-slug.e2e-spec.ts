import type { User } from '@libs/database';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('reserved organization slug', () => {
  let api: ApiTest;
  let staffCount = 0;
  const staff = async (extra: Partial<User> = {}) => {
    staffCount += 1;
    const user = await createUserWith(api, `slugstaff${staffCount}`, {
      permissions: ['judge.add_organization', 'judge.edit_all_organization'],
      ...extra,
    });
    return loginAs(api, user._id);
  };

  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it.each(['usage', 'Usage', 'USAGE'])('refuses to create %s', async (slug) => {
    const session = await staff();
    await authed(api.http().post('/api/internal/organizations'), session)
      .send({ name: 'Reserved', slug })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('refuses to rename an organization to usage and accepts a longer slug', async () => {
    const session = await staff();
    const organization = await createOrganization(api, { slug: 'renameme' });
    await authed(api.http().patch(organizationUrl(organization.slug)), session)
      .send({ slug: 'usage' })
      .expect(400);
    await authed(api.http().post('/api/internal/organizations'), session)
      .send({ name: 'Usage stats club', slug: 'usage_stats' })
      .expect(201);
  });
});
