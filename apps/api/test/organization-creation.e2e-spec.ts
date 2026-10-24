import { organizationCodePrefix } from '@libs/community';
import { uuidStr } from '@libs/database';
import { createOrganization, organizationUrl } from './organization-fixtures';
import type { Contest } from '@libs/database';
import { createContest, hoursFromNow } from './contest-fixtures';
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
  let outsiderId: string;
  let bareAdminId: string;
  let memberId: string;

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
  const editorOf = (answer: { body: unknown }) =>
    (answer.body as { data: { editor: { canPublishToMembers: boolean } } }).data
      .editor;
  const storedProblem = (code: string) => api.problems.findOne({ code }).lean();

  beforeAll(async () => {
    await api.reset();
    catalog = await seedCatalog(api);
    teacherId = await person('teacher', { permissions: ORG_ADMIN_RIGHTS });
    bareAdminId = await person('bareadmin');
    memberId = await person('member', { permissions: ORG_ADMIN_RIGHTS });
    outsiderId = await person('outsider', { permissions: ORG_ADMIN_RIGHTS });
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
      const detail = await authed(
        api.http().get('/api/internal/problems/thptdemo_bai1'),
        sessions.teacher,
      ).expect(200);
      expect(editorOf(detail).canPublishToMembers).toBe(true);
    });

    it("lets an organization create name the organization's administrators as authors and curators", async () => {
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_authors', {
          authors: [teacherId, bareAdminId],
          curators: [bareAdminId],
        }),
      ).expect(201);
      const stored = await storedProblem('thptdemo_authors');
      expect(stored?.authors.map(uuidStr)).toEqual([teacherId, bareAdminId]);
      expect(stored?.curators.map(uuidStr).sort()).toEqual(
        [teacherId, bareAdminId].sort(),
      );
    });

    it.each([
      ['a member as author', () => ({ authors: [teacherId, memberId] })],
      ['an outsider as curator', () => ({ curators: [outsiderId] })],
      ['another staff field', () => ({ summary: 'Tóm tắt' })],
    ])(
      'keeps the staff gate for %s on an organization create',
      async (_what, extra) => {
        await createProblemAs(
          'teacher',
          'thpt-demo',
          problemBody('thptdemo_gated', extra()),
        )
          .expect(403)
          .expect(errorCode('forbidden'));
        expect(await storedProblem('thptdemo_gated')).toBeNull();
      },
    );

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
    it('publishes to members only with create rights in every listed organization', async () => {
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_shared'),
      ).expect(201);
      const third = await createOrganization(api, { slug: 'thirdorg' });
      await api.problems.updateOne(
        { code: 'thptdemo_shared' },
        { $push: { organizations: third._id } },
      );
      await authed(
        api.http().patch('/api/internal/problems/thptdemo_shared'),
        sessions.teacher,
      )
        .send({ isPublic: true })
        .expect(403);
      expect((await storedProblem('thptdemo_shared'))?.isPublic).toBe(false);
      const detail = await authed(
        api.http().get('/api/internal/problems/thptdemo_shared'),
        sessions.teacher,
      ).expect(200);
      expect(editorOf(detail).canPublishToMembers).toBe(false);
    });

    it('leaves the code of a problem that is not organization-private alone', async () => {
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_site'),
      ).expect(201);
      await api.problems.updateOne(
        { code: 'thptdemo_site' },
        { $set: { isOrganizationPrivate: false } },
      );
      await authed(
        api.http().patch('/api/internal/problems/thptdemo_site'),
        sessions.teacher,
      )
        .send({ code: 'sitecode' })
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

    it("lets an administrator put the organization's members-only problems in its contest, but not another organization's", async () => {
      const membersOnly = (code: string, organization: string) =>
        createProblem(api, catalog, {
          code,
          isPublic: true,
          isOrganizationPrivate: true,
          organizations: [organization],
        });
      const own = await membersOnly('thptdemo_own', organizationId);
      const foreign = await membersOnly(
        'otherorg_foreign',
        otherOrganizationId,
      );
      const withProblem = (key: string, problem: { _id: string }) =>
        contestBody(key, { problems: [{ problem: problem._id, points: 100 }] });
      await createContestAs(
        'teacher',
        'thpt-demo',
        withProblem('thptdemo_own_kt', own),
      ).expect(201);
      await createContestAs(
        'teacher',
        'thpt-demo',
        withProblem('thptdemo_foreign_kt', foreign),
      ).expect(400);
    });

    it('still refuses the site-wide create without judge.add_contest', async () => {
      await authed(api.http().post('/api/internal/contests'), sessions.teacher)
        .send(contestBody('sitewide'))
        .expect(403);
    });
  });

  describe("another organization's contests and problems", () => {
    let rivalId: string;
    let setterId: string;
    let setterOrganizationId: string;
    let siteSetterOrganizationId: string;
    let siteSetterId: string;
    const patchContestAs = (who: string, key: string, body: object) =>
      authed(
        api.http().patch(`/api/internal/contests/${key}`),
        sessions[who],
      ).send(body);
    const storedOrganizations = async (key: string) =>
      (await api.contests.findOne({ key }).lean())?.organizations.map(uuidStr);
    /** A contest of thpt-demo made by its administrator `teacher` through the organization route. */
    const teacherContest = async (key: string) => {
      await createContestAs('teacher', 'thpt-demo', contestBody(key)).expect(
        201,
      );
      return key;
    };

    beforeAll(async () => {
      const rival = await createOrganization(api, {
        slug: 'rivalorg',
        adminIds: [outsiderId],
      });
      rivalId = uuidStr(rival._id);
      setterId = await person('setter', {
        permissions: [...ORG_ADMIN_RIGHTS, 'judge.clone_contest'],
      });
      siteSetterId = await person('siteSetter', {
        permissions: [
          'judge.add_contest',
          'judge.edit_own_contest',
          'judge.create_private_contest',
        ],
      });
      await person('contestStaff', {
        permissions: [
          'judge.add_contest',
          'judge.edit_all_contest',
          'judge.create_private_contest',
        ],
      });
      siteSetterOrganizationId = uuidStr(
        (
          await createOrganization(api, {
            slug: 'sitesetterorg',
            adminIds: [siteSetterId],
          })
        )._id,
      );
      const setterOrganization = await createOrganization(api, {
        slug: 'setterorg',
        adminIds: [setterId],
      });
      setterOrganizationId = uuidStr(setterOrganization._id);
    });

    it('refuses an organization administrator moving their contest into an organization they do not administer', async () => {
      const key = await teacherContest('kt_move_rival');
      await patchContestAs('teacher', key, {
        organizations: [organizationId, rivalId],
      })
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      expect(await storedOrganizations(key)).toEqual([organizationId]);
    });

    it('lets them add another organization they also administer', async () => {
      const key = await teacherContest('kt_move_other');
      await patchContestAs('teacher', key, {
        organizations: [organizationId, otherOrganizationId],
      }).expect(200);
      expect(await storedOrganizations(key)).toEqual([
        organizationId,
        otherOrganizationId,
      ]);
    });

    it('keeps edits that leave the organizations alone open to the author', async () => {
      const key = await teacherContest('kt_rename');
      await patchContestAs('teacher', key, {
        name: 'Kiểm tra giữa kỳ',
        organizations: [organizationId],
      }).expect(200);
      expect((await api.contests.findOne({ key }).lean())?.name).toBe(
        'Kiểm tra giữa kỳ',
      );
    });

    it("hides an organization's contest and problem from another organization's administrator, who cannot edit them", async () => {
      const key = await teacherContest('kt_foreign');
      await patchContestAs('outsider', key, { name: 'Đổi tên' }).expect(404);
      expect((await api.contests.findOne({ key }).lean())?.name).toBe(
        'Kiểm tra',
      );
      await createProblemAs(
        'teacher',
        'thpt-demo',
        problemBody('thptdemo_foreign'),
      ).expect(201);
      await authed(
        api.http().patch('/api/internal/problems/thptdemo_foreign'),
        sessions.outsider,
      )
        .send({ name: 'Đổi tên' })
        .expect(404);
      expect((await storedProblem('thptdemo_foreign'))?.name).toBe(
        'Tổng hai số',
      );
    });

    /** A contest stored directly (as staff would leave it), with `teacher` and `setter` as authors. */
    const staffContest = (key: string, overrides: Partial<Contest>) =>
      createContest(api, {
        key,
        isVisible: false,
        isOrganizationPrivate: true,
        authors: [teacherId, setterId],
        ...overrides,
      });

    it('refuses removing an organization the editor does not administer', async () => {
      await staffContest('kt_remove_rival', {
        organizations: [organizationId, rivalId],
      });
      await patchContestAs('teacher', 'kt_remove_rival', {
        organizations: [organizationId],
      })
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      expect(await storedOrganizations('kt_remove_rival')).toEqual([
        organizationId,
        rivalId,
      ]);
    });

    it('refuses an organization administrator taking a contest out of every organization onto the site', async () => {
      const key = await teacherContest('kt_to_site');
      await patchContestAs('teacher', key, { isOrganizationPrivate: false })
        .expect(403)
        .expect(issueCodes(['site_contest_rights']));
      expect(
        (await api.contests.findOne({ key }).lean())?.isOrganizationPrivate,
      ).toBe(true);
    });

    it('refuses opening a visible private contest to everyone without judge.change_contest_visibility', async () => {
      await staffContest('kt_visible', {
        organizations: [setterOrganizationId],
        isVisible: true,
      });
      await patchContestAs('setter', 'kt_visible', {
        isOrganizationPrivate: false,
      })
        .expect(403)
        .expect(({ body }: { body: { error: { message: string } } }) =>
          expect(body.error.message).toMatch(/change_contest_visibility/),
        );
      expect(
        (await api.contests.findOne({ key: 'kt_visible' }).lean())
          ?.isOrganizationPrivate,
      ).toBe(true);
    });

    it('refuses making a contest private to no organization a site contest', async () => {
      await staffContest('kt_no_org', { organizations: [] });
      await patchContestAs('setter', 'kt_no_org', {
        isOrganizationPrivate: false,
      })
        .expect(403)
        .expect(issueCodes(['site_contest_rights']));
      expect(
        (await api.contests.findOne({ key: 'kt_no_org' }).lean())
          ?.isOrganizationPrivate,
      ).toBe(true);
    });

    it('refuses showing a contest made public while hidden, one step at a time', async () => {
      await staffContest('kt_steps', {
        organizations: [setterOrganizationId],
        isOrganizationPrivate: false,
        isPrivate: true,
      });
      await patchContestAs('setter', 'kt_steps', { isPrivate: false }).expect(
        200,
      );
      await patchContestAs('setter', 'kt_steps', { isVisible: true })
        .expect(403)
        .expect(({ body }: { body: { error: { message: string } } }) =>
          expect(body.error.message).toMatch(/change_contest_visibility/),
        );
      expect(
        (await api.contests.findOne({ key: 'kt_steps' }).lean())?.isVisible,
      ).toBe(false);
    });

    it('refuses opening a visible contest private to chosen users to everyone', async () => {
      await staffContest('kt_visible_users', {
        organizations: [setterOrganizationId],
        isOrganizationPrivate: false,
        isPrivate: true,
        isVisible: true,
      });
      await patchContestAs('setter', 'kt_visible_users', { isPrivate: false })
        .expect(403)
        .expect(({ body }: { body: { error: { message: string } } }) =>
          expect(body.error.message).toMatch(/change_contest_visibility/),
        );
      expect(
        (await api.contests.findOne({ key: 'kt_visible_users' }).lean())
          ?.isPrivate,
      ).toBe(true);
    });

    it('scopes a site contest creator to the organizations they administer (owner decision Q1)', async () => {
      await authed(
        api.http().post('/api/internal/contests'),
        sessions.siteSetter,
      )
        .send(
          contestBody('kt_site_rival', {
            organizations: [rivalId],
            isOrganizationPrivate: true,
          }),
        )
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      expect(await api.contests.findOne({ key: 'kt_site_rival' })).toBeNull();
      await authed(
        api.http().post('/api/internal/contests'),
        sessions.siteSetter,
      )
        .send(
          contestBody('kt_site_own', {
            organizations: [siteSetterOrganizationId],
            isOrganizationPrivate: true,
          }),
        )
        .expect(201);
      await patchContestAs('siteSetter', 'kt_site_own', {
        organizations: [siteSetterOrganizationId, rivalId],
      })
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      await patchContestAs('siteSetter', 'kt_site_own', {
        organizations: [],
        isOrganizationPrivate: false,
      }).expect(200);
      expect(await storedOrganizations('kt_site_own')).toEqual([]);
    });

    it('lets a site contest creator name any organization on a contest that stays public, but not scope it there', async () => {
      await authed(
        api.http().post('/api/internal/contests'),
        sessions.siteSetter,
      )
        .send(contestBody('kt_site_label', { organizations: [rivalId] }))
        .expect(201);
      await patchContestAs('siteSetter', 'kt_site_label', {
        isOrganizationPrivate: true,
      })
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      expect(
        (await api.contests.findOne({ key: 'kt_site_label' }).lean())
          ?.isOrganizationPrivate,
      ).toBe(false);
    });

    it('refuses a site contest creator taking a contest out of an organization they do not administer', async () => {
      await staffContest('kt_site_foreign', {
        organizations: [rivalId],
        authors: [siteSetterId],
      });
      await patchContestAs('siteSetter', 'kt_site_foreign', {
        organizations: [],
        isOrganizationPrivate: false,
      })
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      expect(await storedOrganizations('kt_site_foreign')).toEqual([rivalId]);
    });

    it('lets a judge.edit_all_contest holder list any organization', async () => {
      await authed(
        api.http().post('/api/internal/contests'),
        sessions.contestStaff,
      )
        .send(contestBody('kt_staff_rival', { organizations: [rivalId] }))
        .expect(201);
      expect(await storedOrganizations('kt_staff_rival')).toEqual([rivalId]);
    });

    it('refuses cloning a contest into an organization the cloner does not administer', async () => {
      await staffContest('kt_clone_src', { organizations: [rivalId] });
      await authed(
        api.http().post('/api/internal/contests/kt_clone_src/clone'),
        sessions.setter,
      )
        .send({ key: 'kt_clone_copy' })
        .expect(403)
        .expect(issueCodes(['organization_rights']));
      expect(await api.contests.findOne({ key: 'kt_clone_copy' })).toBeNull();
    });

    it('lets a superuser move a contest into any organization', async () => {
      const key = await teacherContest('kt_root_move');
      await patchContestAs('root', key, { organizations: [rivalId] }).expect(
        200,
      );
      expect(await storedOrganizations(key)).toEqual([rivalId]);
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

    it('tells the code prefix of the organization', async () => {
      const response = await authed(
        api.http().get(organizationUrl('thpt-demo')),
        sessions.teacher,
      ).expect(200);
      expect(response.body as unknown).toMatchObject({
        data: { problemCodePrefix: 'thptdemo_' },
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

  describe('the organizations the viewer may create in', () => {
    /** Every live organization of this spec, whatever its listing. */
    const liveSlugs = async () =>
      (await api.organizations.find({ deletedAt: null }).lean())
        .map((organization) => organization.slug)
        .sort();
    const EVERY = 'every live organization' as const;
    const listFor = (who: string | null, query: object) => {
      const request = api
        .http()
        .get('/api/internal/organizations')
        .query({ pageSize: 100, ...query });
      return who === null ? request : authed(request, sessions[who]);
    };
    const creatable = async (who: string, kind: 'problem' | 'contest') =>
      (
        (await listFor(who, { canCreate: kind }).expect(200)).body as {
          data: { slug: string }[];
        }
      ).data
        .map((organization) => organization.slug)
        .sort();
    const createIn = (
      kind: 'problem' | 'contest',
      who: string,
      slug: string,
    ) => {
      const name = `eq_${who.toLowerCase()}`;
      return kind === 'problem'
        ? createProblemAs(
            who,
            slug,
            problemBody(`${organizationCodePrefix(slug)}${name}`),
          )
        : createContestAs(
            who,
            slug,
            contestBody(`${name}_${slug.replaceAll('-', '')}`),
          );
    };

    beforeAll(async () => {
      await createOrganization(api, {
        slug: 'hiddenorg',
        isUnlisted: true,
        adminIds: [teacherId],
      });
      await createOrganization(api, {
        slug: 'goneorg',
        adminIds: [teacherId],
        deletedAt: new Date(),
      });
    });

    it.each([
      [
        'an administrator of two listed organizations and an unlisted one',
        'teacher',
        ['hiddenorg', 'otherorg', 'thpt-demo'],
        ['hiddenorg', 'otherorg', 'thpt-demo'],
      ],
      [
        'an administrator of another organization only',
        'outsider',
        ['rivalorg'],
        ['rivalorg'],
      ],
      [
        'an administrator without the creation permissions',
        'bareadmin',
        [],
        [],
      ],
      ['a member who is not an administrator', 'member', [], []],
      [
        'a site contest creator who administers one organization',
        'siteSetter',
        [],
        ['sitesetterorg'],
      ],
      [
        'a judge.edit_all_organization holder with the permissions',
        'editsall',
        EVERY,
        EVERY,
      ],
      ['a superuser', 'root', EVERY, EVERY],
    ])('lists for %s', async (_who, who, problems, contests) => {
      const resolve = async (slugs: string[] | typeof EVERY) =>
        slugs === EVERY ? liveSlugs() : slugs;
      expect(await creatable(who, 'problem')).toEqual(await resolve(problems));
      expect(await creatable(who, 'contest')).toEqual(await resolve(contests));
    });

    it('keeps the other list filters working over the creatable ones', async () => {
      const slugs = async (query: object) =>
        (
          (await listFor('teacher', query).expect(200)).body as {
            data: { slug: string }[];
          }
        ).data.map((organization) => organization.slug);
      expect(await slugs({ canCreate: 'contest', search: 'other' })).toEqual([
        'otherorg',
      ]);
      expect(await slugs({ canCreate: 'contest', unlisted: 'true' })).toEqual([
        'hiddenorg',
      ]);
    });

    it('refuses an anonymous viewer and an unknown kind', async () => {
      await listFor(null, { canCreate: 'contest' })
        .expect(401)
        .expect(errorCode('unauthorized'));
      await listFor('teacher', { canCreate: 'post' }).expect(400);
    });

    it.each(['problem', 'contest'] as const)(
      'matches the organizations the %s create route accepts, for every viewer and organization',
      async (kind) => {
        const live = await liveSlugs();
        const outcomes: Record<string, Record<string, number>> = {};
        const expected: typeof outcomes = {};
        for (const who of [
          'teacher',
          'bareadmin',
          'member',
          'outsider',
          'siteSetter',
          'editsall',
        ]) {
          const allowed = await creatable(who, kind);
          outcomes[who] = {};
          expected[who] = {};
          for (const slug of [...live, 'goneorg']) {
            outcomes[who][slug] = (await createIn(kind, who, slug)).status;
            if (allowed.includes(slug)) expected[who][slug] = 201;
            else expected[who][slug] = slug === 'goneorg' ? 404 : 403;
          }
        }
        expect(outcomes).toEqual(expected);
      },
    );

    it('matches the organizations a site contest creator may scope a contest to on the site route', async () => {
      const allowed = await creatable('siteSetter', 'contest');
      const ids = new Map(
        (await api.organizations.find({ deletedAt: null }).lean()).map(
          (organization) => [organization.slug, uuidStr(organization._id)],
        ),
      );
      const outcomes: Record<string, number> = {};
      for (const slug of ids.keys())
        outcomes[slug] = (
          await authed(
            api.http().post('/api/internal/contests'),
            sessions.siteSetter,
          ).send(
            contestBody(`site_${slug.replaceAll('-', '')}`, {
              organizations: [ids.get(slug)],
              isOrganizationPrivate: true,
            }),
          )
        ).status;
      expect(outcomes).toEqual(
        Object.fromEntries(
          [...ids.keys()].map((slug) => [
            slug,
            allowed.includes(slug) ? 201 : 403,
          ]),
        ),
      );
    });
  });
});
