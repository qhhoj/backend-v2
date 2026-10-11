import { uuidStr } from '@libs/database';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { hoursFromNow } from './contest-fixtures';
import {
  authed,
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

/** The `Org Admin` role's creation rights, held directly here. */
const ORG_ADMIN_RIGHTS = [
  'judge.create_organization_problem',
  'judge.create_private_contest',
  'judge.edit_own_problem',
  'judge.edit_own_contest',
];

describe('creating problems and contests for an organization', () => {
  let catalog: Catalog;
  let organizationId: string;
  let otherOrganizationId: string;
  const sessions: Record<string, TestSession> = {};
  let teacherId: string;

  const person = async (
    name: string,
    extra: Parameters<typeof createUserWith>[2] = {},
  ) => {
    const user = await createUserWith(api, name, extra);
    sessions[name] = await loginAs(api, user._id);
    return uuidStr(user._id);
  };
  const problemBody = (code: string, extra: Record<string, unknown> = {}) => ({
    code,
    name: 'Tổng hai số',
    description: 'In ra $a+b$.',
    timeLimit: 1,
    memoryLimit: 262144,
    points: 1000,
    typeIds: [catalog.types.uncategorized],
    groupId: catalog.groups.uncategorized,
    ...extra,
  });
  const contestBody = (key: string, extra: Record<string, unknown> = {}) => ({
    key,
    name: 'Kiểm tra',
    startTime: hoursFromNow(1).toISOString(),
    endTime: hoursFromNow(3).toISOString(),
    ...extra,
  });
  const createProblemAs = (who: string, slug: string, body: object) =>
    authed(
      api.http().post(organizationUrl(slug, '/problems')),
      sessions[who],
    ).send(body);
  const createContestAs = (who: string, slug: string, body: object) =>
    authed(
      api.http().post(organizationUrl(slug, '/contests')),
      sessions[who],
    ).send(body);
  const storedProblem = (code: string) => api.problems.findOne({ code }).lean();

  beforeAll(async () => {
    await api.reset();
    catalog = await seedCatalog(api);
    teacherId = await person('teacher', { permissions: ORG_ADMIN_RIGHTS });
    const bareAdminId = await person('bareadmin');
    const memberId = await person('member', { permissions: ORG_ADMIN_RIGHTS });
    await person('outsider', { permissions: ORG_ADMIN_RIGHTS });
    await person('editsall', {
      permissions: [...ORG_ADMIN_RIGHTS, 'judge.edit_all_organization'],
    });
    await person('root', { isSuperuser: true });
    const organization = await createOrganization(
      api,
      { slug: 'thpt-demo', adminIds: [teacherId, bareAdminId] },
      [memberId],
    );
    organizationId = uuidStr(organization._id);
    const other = await createOrganization(api, {
      slug: 'otherorg',
      adminIds: [teacherId],
    });
    otherOrganizationId = uuidStr(other._id);
  });

  describe('problems', () => {
    it('lets an administrator with the organization permission create a problem private to that organization only', async () => {
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_bai1', {
          organizations: [otherOrganizationId],
          isOrganizationPrivate: false,
        }),
      ).expect(201);
      const stored = await storedProblem('thptdemo_bai1');
      expect(stored?.isOrganizationPrivate).toBe(true);
      expect(stored?.organizations.map(uuidStr)).toEqual([organizationId]);
      expect(stored?.curators.map(uuidStr)).toEqual([teacherId]);
    });

    it.each([
      ['an administrator without the organization permission', 'bareadmin'],
      ['a member who is not an administrator', 'member'],
      ['an administrator of another organization only', 'outsider'],
    ])('refuses %s', async (_who, who) => {
      await createProblemAs(who, 'thpt-demo', problemBody(`thptdemo_${who}`))
        .expect(403)
        .expect(errorCode('forbidden'));
      expect(await storedProblem(`thptdemo_${who}`)).toBeNull();
    });

    it('lets a judge.edit_all_organization holder with the permission create for any organization', async () => {
      await createProblemAs(
        'editsall',
        'thpt-demo',
        problemBody('thptdemo_staff'),
      ).expect(201);
    });

    it('answers 404 for an unknown organization', async () => {
      await createProblemAs('teacher', 'nowhere', problemBody('nowhere_a'))
        .expect(404)
        .expect(errorCode('not_found'));
    });

    it.each([
      ['no prefix', 'bai2'],
      ['another organization prefix', 'otherorg_bai2'],
      ['the prefix alone', 'thptdemo_'],
    ])(
      'refuses a code with %s (400 organization_code_prefix)',
      async (_case, code) => {
        await createProblemAs('teacher', 'thpt-demo', problemBody(code))
          .expect(400)
          .expect(issueCodes(['organization_code_prefix']));
        expect(await storedProblem(code)).toBeNull();
      },
    );

    it('lets a superuser choose any code', async () => {
      await createProblemAs(
        'root',
        'thpt-demo',
        problemBody('freecode'),
      ).expect(201);
      expect((await storedProblem('freecode'))?.isOrganizationPrivate).toBe(
        true,
      );
    });

    it('lets an organization creator show the problem to members (isPublic) without change_public_visibility', async () => {
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_open', { isPublic: true }),
      ).expect(201);
      await authed(
        api.http().patch('/api/internal/problems/thptdemo_bai1'),
        sessions.teacher,
      )
        .send({ isPublic: true })
        .expect(200);
      expect((await storedProblem('thptdemo_bai1'))?.isPublic).toBe(true);
    });

    it('keeps the other staff gates on an organization create', async () => {
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_authors', { authors: [teacherId] }),
      ).expect(403);
    });

    it('checks the prefix when an organization problem is renamed, and lets unrelated edits through', async () => {
      await api.problems.updateOne(
        { code: 'thptdemo_bai1' },
        { $set: { code: 'legacy_code' } },
      );
      await authed(
        api.http().patch('/api/internal/problems/legacy_code'),
        sessions.teacher,
      )
        .send({ name: 'Đổi tên bài' })
        .expect(200);
      await authed(
        api.http().patch('/api/internal/problems/legacy_code'),
        sessions.teacher,
      )
        .send({ code: 'still_wrong' })
        .expect(400)
        .expect(issueCodes(['organization_code_prefix']));
      await authed(
        api.http().patch('/api/internal/problems/legacy_code'),
        sessions.teacher,
      )
        .send({ code: 'thptdemo_bai1' })
        .expect(200);
    });
  });

  describe('contests', () => {
    it('lets an administrator with create_private_contest create a contest private to that organization only', async () => {
      await createContestAs(
        'teacher',
        'thpt-demo',
        contestBody('thptdemo_kt1', {
          organizations: [otherOrganizationId],
          isOrganizationPrivate: false,
        }),
      ).expect(201);
      const stored = await api.contests.findOne({ key: 'thptdemo_kt1' }).lean();
      expect(stored?.isOrganizationPrivate).toBe(true);
      expect(stored?.organizations.map(uuidStr)).toEqual([organizationId]);
      expect(stored?.authors.map(uuidStr)).toEqual([teacherId]);
    });

    it.each([
      ['an administrator without create_private_contest', 'bareadmin'],
      ['a member who is not an administrator', 'member'],
      ['an administrator of another organization only', 'outsider'],
    ])('refuses %s', async (_who, who) => {
      await createContestAs(who, 'thpt-demo', contestBody(`kt_${who}`))
        .expect(403)
        .expect(errorCode('forbidden'));
      expect(await api.contests.findOne({ key: `kt_${who}` })).toBeNull();
    });

    it('still refuses the site-wide create without judge.add_contest', async () => {
      await authed(api.http().post('/api/internal/contests'), sessions.teacher)
        .send(contestBody('sitewide'))
        .expect(403);
    });
  });

  describe('what the viewer is told', () => {
    it('reports the organization page create flags from the same rule', async () => {
      const viewerOf = async (who: string) =>
        (
          (
            await authed(
              api.http().get(organizationUrl('thpt-demo')),
              sessions[who],
            ).expect(200)
          ).body as { data: { viewer: unknown } }
        ).data.viewer;
      expect(await viewerOf('teacher')).toMatchObject({
        canCreateProblem: true,
        canCreateContest: true,
      });
      expect(await viewerOf('bareadmin')).toMatchObject({
        canAdminister: true,
        canCreateProblem: false,
        canCreateContest: false,
      });
      expect(await viewerOf('member')).toMatchObject({
        canCreateProblem: false,
        canCreateContest: false,
      });
    });

    it('reports the session creation scopes', async () => {
      const capabilitiesOf = async (who: string) => {
        const response = await authed(
          api.http().get('/api/internal/auth/me'),
          sessions[who],
        );
        const body = response.body as {
          data: { user: { adminCapabilities: unknown } };
        };
        return body.data.user.adminCapabilities;
      };
      expect(await capabilitiesOf('teacher')).toMatchObject({
        problemCreation: { site: false, organizations: true },
        contestCreation: { site: false, organizations: true },
      });
      expect(await capabilitiesOf('bareadmin')).toMatchObject({
        problemCreation: { site: false, organizations: false },
        contestCreation: { site: false, organizations: false },
      });
      expect(await capabilitiesOf('member')).toMatchObject({
        problemCreation: { site: false, organizations: false },
      });
      expect(await capabilitiesOf('root')).toMatchObject({
        problemCreation: { site: true, organizations: true },
        contestCreation: { site: true, organizations: true },
      });
    });
  });
});
