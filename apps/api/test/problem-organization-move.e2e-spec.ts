import { getModelToken } from '@nestjs/mongoose';
import { REDIS } from '@libs/common';
import { OrganizationUsage, uuidStr } from '@libs/database';
import type Redis from 'ioredis';
import type { Model } from 'mongoose';
import { QUOTA_BACKFILL_DONE_KEY } from '../src/modules/organizations/quota/quota.constants';
import { createOrganization } from './organization-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';

let api: ApiTest;
beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

/** The `Org Admin` role's problem rights, held directly here. */
const ORG_ADMIN_RIGHTS = [
  'judge.create_organization_problem',
  'judge.edit_own_problem',
];

describe('PATCH /problems/{code}: moving a problem between organizations', () => {
  let catalog: Catalog;
  let usage: Model<OrganizationUsage>;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};

  const person = async (name: string, permissions: string[]) => {
    const user = await createUserWith(api, name, { permissions });
    sessions[name] = await loginAs(api, user._id);
    ids[name] = uuidStr(user._id);
  };
  /** A problem every test person edits (curator), private to `organizations` when any is given. */
  const problem = (code: string, organizations: string[], dataBytes = 0) =>
    createProblem(api, catalog, {
      code,
      organizations,
      isOrganizationPrivate: organizations.length > 0,
      curators: Object.values(ids),
      dataBytes,
    });
  const patch = (who: string, code: string, body: object) =>
    authed(
      api.http().patch(`/api/internal/problems/${code}`),
      sessions[who],
    ).send(body);
  const stored = async (code: string) => {
    const row = await api.problems.findOne({ code }).lean();
    return (
      row && {
        organizations: row.organizations.map(uuidStr),
        isOrganizationPrivate: row.isOrganizationPrivate,
      }
    );
  };
  const creditsOf = async (organizationId: string) =>
    (await usage.findOne({ organization: organizationId }).lean())
      ?.creditsUsed ?? 0;

  beforeAll(async () => {
    await api.reset();
    catalog = await seedCatalog(api);
    usage = api.app.get(getModelToken(OrganizationUsage.name));
    await api.setSetting('quota.cost.problem', 10);
    await person('owner', ORG_ADMIN_RIGHTS);
    await person('siteowner', [...ORG_ADMIN_RIGHTS, 'judge.add_problem']);
    await person('member', ORG_ADMIN_RIGHTS);
    await person('staff', ['judge.edit_own_problem', 'judge.edit_all_problem']);
    await person('adder', ['judge.add_problem', 'judge.edit_own_problem']);
    const alpha = await createOrganization(
      api,
      { slug: 'alpha', adminIds: [ids.owner, ids.siteowner] },
      [ids.member],
    );
    const beta = await createOrganization(api, {
      slug: 'beta',
      adminIds: [ids.owner],
    });
    const tiny = await createOrganization(api, {
      slug: 'tiny',
      adminIds: [ids.owner],
      quotaStorageBytes: 10,
    });
    ids.alpha = uuidStr(alpha._id);
    ids.beta = uuidStr(beta._id);
    ids.tiny = uuidStr(tiny._id);
  });
  beforeEach(async () => {
    await api.setSetting('quota.enforce', 'enforce');
    await api.app.get<Redis>(REDIS).set(QUOTA_BACKFILL_DONE_KEY, '1');
  });

  it('moves a problem from one organization to another for an administrator of both, with the code renamed in the same save', async () => {
    await problem('alpha_one', [ids.alpha]);
    await patch('owner', 'alpha_one', {
      organizations: [ids.beta],
      code: 'beta_one',
    }).expect(200);
    expect(await stored('beta_one')).toEqual({
      organizations: [ids.beta],
      isOrganizationPrivate: true,
    });
    expect(await creditsOf(ids.beta)).toBe(0);
  });

  it('moves a problem to another organization keeping its code, and checks only a new code against the new prefix', async () => {
    await problem('alpha_two', [ids.alpha]);
    await patch('owner', 'alpha_two', {
      organizations: [ids.beta],
      code: 'alpha_two_renamed',
    })
      .expect(400)
      .expect(issueCodes(['organization_code_prefix']));
    await patch('owner', 'alpha_two', { organizations: [ids.beta] }).expect(
      200,
    );
    expect(await stored('alpha_two')).toEqual({
      organizations: [ids.beta],
      isOrganizationPrivate: true,
    });
  });

  it('refuses an editor who is only a member of the organization with organization_rights', async () => {
    await problem('alpha_three', [ids.alpha]);
    await patch('member', 'alpha_three', {
      organizations: [ids.beta],
      code: 'beta_three',
    })
      .expect(403)
      .expect(issueCodes(['organization_rights']));
  });

  it('refuses an organization administrator who cannot edit the problem', async () => {
    await createProblem(api, catalog, {
      code: 'alpha_foreign',
      organizations: [ids.alpha],
      isOrganizationPrivate: true,
    });
    await patch('owner', 'alpha_foreign', {
      organizations: [ids.beta],
      code: 'beta_foreign',
    })
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('moves a site problem into an organization the editor administers and charges the problem credit', async () => {
    await problem('beta_site', []);
    await patch('owner', 'beta_site', {
      organizations: [ids.beta],
      isOrganizationPrivate: true,
    }).expect(200);
    expect(await stored('beta_site')).toEqual({
      organizations: [ids.beta],
      isOrganizationPrivate: true,
    });
    expect(await creditsOf(ids.beta)).toBe(10);
  });

  it('refuses a move into an organization whose storage the problem does not fit', async () => {
    await problem('tiny_big', [ids.alpha], 100);
    await patch('owner', 'tiny_big', { organizations: [ids.tiny] })
      .expect(403)
      .expect(errorCode('quota_exceeded'));
    expect((await stored('tiny_big'))?.organizations).toEqual([ids.alpha]);
  });

  it('moves a problem onto the site only with judge.add_problem', async () => {
    await problem('alpha_out', [ids.alpha]);
    const toSite = { organizations: [], isOrganizationPrivate: false };
    await patch('owner', 'alpha_out', toSite)
      .expect(403)
      .expect(issueCodes(['site_problem_rights']));
    await patch('siteowner', 'alpha_out', toSite).expect(200);
    expect(await stored('alpha_out')).toEqual(toSite);
  });

  it('refuses making a problem private to no organization a site problem without judge.add_problem', async () => {
    // What an organization's deletion leaves: private, with no organization left.
    await createProblem(api, catalog, {
      code: 'orphan_out',
      organizations: [],
      isOrganizationPrivate: true,
      isPublic: false,
      curators: [ids.member],
    });
    await patch('member', 'orphan_out', { isOrganizationPrivate: false })
      .expect(403)
      .expect(issueCodes(['site_problem_rights']));
    expect(await stored('orphan_out')).toEqual({
      organizations: [],
      isOrganizationPrivate: true,
    });
  });

  it('keeps every right of a judge.edit_all_problem holder', async () => {
    await problem('alpha_staff', [ids.alpha]);
    await patch('staff', 'alpha_staff', {
      organizations: [],
      isOrganizationPrivate: false,
    }).expect(200);
  });

  it('keeps the staff gate on organizations when creating a site problem', async () => {
    await authed(api.http().post('/api/internal/problems'), sessions.adder)
      .send({
        code: 'adder_one',
        name: 'Tổng hai số',
        timeLimit: 1,
        memoryLimit: 262144,
        points: 1000,
        typeIds: [catalog.types.uncategorized],
        groupId: catalog.groups.uncategorized,
        organizations: [ids.alpha],
      })
      .expect(403);
  });
});
