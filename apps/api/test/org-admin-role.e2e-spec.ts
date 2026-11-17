import { GroupsQuerier } from '@libs/auth';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

/** Admin changes: a new admin must already be a member (unless staff), and the admin role follows organization creation and demotion. */
describe('Organization admin changes', () => {
  let api: ApiTest;
  let roleId: string;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};

  beforeAll(async () => {
    api = await setupApiTest();
    const roles: Array<[string, Partial<User>]> = [
      ['owner', { permissions: ['judge.add_organization'] }],
      ['member', {}],
      ['outsider', {}],
      ['staff', { permissions: ['judge.edit_all_organization'] }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    const role = await api.groups.create({
      name: 'Org Admin',
      permissions: ['judge.edit_own_problem'],
    });
    roleId = uuidStr(role._id);
    await api.app.get(GroupsQuerier).resync();
  });

  afterAll(() => api.teardown());

  const hasRole = async (who: string) =>
    (await api.users.findById(users[who]._id).lean())!.groups
      .map(uuidStr)
      .includes(roleId);
  const setAdmins = (slug: string, as: string, names: string[]) =>
    authed(api.http().patch(organizationUrl(slug)), sessions[as]).send({
      adminIds: names.map((name) => users[name]._id),
    });

  it('refuses a non-member as new admin, accepts a member, gives no role on update, takes it back on demotion', async () => {
    const created = await authed(
      api.http().post('/api/internal/organizations'),
      sessions.owner,
    )
      .send({ name: 'Role Org', slug: 'role-org' })
      .expect(201);
    const slug = (created.body as { data: { slug: string } }).data.slug;
    expect(await hasRole('owner')).toBe(true);

    const refused = await setAdmins(slug, 'owner', [
      'owner',
      'outsider',
    ]).expect(422);
    expect(JSON.stringify(refused.body)).toContain('not_a_member');
    expect(await hasRole('outsider')).toBe(false);

    await api.users.updateOne(
      { _id: users.member._id },
      {
        $push: {
          organizations: (await api.organizations.findOne({ slug }))!._id,
        },
      },
    );
    await setAdmins(slug, 'owner', ['owner', 'member']).expect(200);
    expect(await hasRole('member')).toBe(false);

    await setAdmins(slug, 'member', ['member']).expect(200);
    expect(await hasRole('owner')).toBe(false);
  });

  it('keeps the role of a demoted admin who administers another organization', async () => {
    const other = await createOrganization(api, {
      adminIds: [users.member._id],
    });
    const first = await createOrganization(api, {
      adminIds: [users.member._id, users.owner._id],
    });
    await api.users.updateOne(
      { _id: users.member._id },
      { $addToSet: { groups: roleId } },
    );
    await setAdmins(first.slug, 'owner', ['owner']).expect(200);
    expect(await hasRole('member')).toBe(true);
    expect(other.adminIds.map(uuidStr)).toContain(users.member._id);
  });

  it('lets staff add a non-member as admin', async () => {
    const organization = await createOrganization(api, {
      adminIds: [users.owner._id],
    });
    await setAdmins(organization.slug, 'staff', ['owner', 'outsider']).expect(
      200,
    );
    const stored = (await api.organizations.findById(organization._id).lean())!;
    expect(stored.adminIds.map(uuidStr)).toContain(users.outsider._id);
  });
});
