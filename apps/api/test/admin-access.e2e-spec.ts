import type { User } from '@libs/database';
import { createContest, contestUrl } from './contest-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const ME = '/api/internal/auth/me';
const PROBLEMS = '/api/internal/problems';
const CONTESTS = '/api/internal/contests';
const ORGANIZATIONS = '/api/internal/organizations';

const listed = ({ body }: { body: unknown }, field: string) =>
  (body as { data: Record<string, string>[] }).data.map((row) => row[field]);

/** Who may use the admin editors: object rights and permissions decide, never the staff flag (none of these users is staff). */
describe('admin access for authors who are not staff', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const ids: Record<string, string> = {};

  const person = async (name: string, extra: Partial<User> = {}) => {
    const user = await createUserWith(api, name, { isStaff: false, ...extra });
    ids[name] = user._id;
    sessions[name] = await loginAs(api, user._id);
  };
  const capabilitiesOf = async (who: string) =>
    (
      (await authed(api.http().get(ME), sessions[who]).expect(200)).body as {
        data: { user: { adminCapabilities: { organizations: boolean } } };
      }
    ).data.user.adminCapabilities;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    await person('author', { permissions: ['judge.edit_own_problem'] });
    await person('organizer', { permissions: ['judge.edit_own_contest'] });
    await person('orgAdmin');
    await person('orgEditor', { permissions: ['judge.edit_all_organization'] });
    await person('nobody');
    await createProblem(api, catalog, {
      code: 'own_private',
      isPublic: false,
      authors: [ids.author],
    });
    await createProblem(api, catalog, { code: 'others_public' });
    await createContest(api, { key: 'own_round', authors: [ids.organizer] });
    await createContest(api, { key: 'others_round' });
    await createOrganization(api, { slug: 'mine', adminIds: [ids.orgAdmin] });
    await createOrganization(api, { slug: 'theirs' });
  });
  afterAll(() => api.teardown());

  describe('the session tells which object rights stand behind the admin screens', () => {
    it('an organization admin, or a holder of edit_all_organization, administers organizations', async () => {
      expect(await capabilitiesOf('orgAdmin')).toEqual({ organizations: true });
      expect(await capabilitiesOf('orgEditor')).toEqual({
        organizations: true,
      });
    });

    it('anyone else administers none', async () => {
      expect(await capabilitiesOf('nobody')).toEqual({ organizations: false });
      expect(await capabilitiesOf('author')).toEqual({ organizations: false });
    });
  });

  describe('problems', () => {
    it('an author with edit_own_problem edits their own problem but not another', async () => {
      await authed(api.http().patch(`${PROBLEMS}/own_private`), sessions.author)
        .send({ name: 'Renamed' })
        .expect(200);
      await authed(
        api.http().patch(`${PROBLEMS}/others_public`),
        sessions.author,
      )
        .send({ name: 'Hijacked' })
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('a user without rights edits nothing', async () => {
      await authed(
        api.http().patch(`${PROBLEMS}/others_public`),
        sessions.nobody,
      )
        .send({ name: 'Hijacked' })
        .expect(403);
      await authed(api.http().patch(`${PROBLEMS}/own_private`), sessions.nobody)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('editable=true lists only the problems the viewer may edit; false the rest', async () => {
      const list = (who: string, editable: boolean) =>
        authed(
          api
            .http()
            .get(PROBLEMS)
            .query({ visibility: 'all', editable: String(editable) }),
          sessions[who],
        ).expect(200);
      expect(listed(await list('author', true), 'code')).toEqual([
        'own_private',
      ]);
      expect(listed(await list('author', false), 'code')).toEqual([
        'others_public',
      ]);
      expect(listed(await list('nobody', true), 'code')).toEqual([]);
    });
  });

  describe('contests', () => {
    it('an author with edit_own_contest edits their own contest but not another', async () => {
      await authed(
        api.http().patch(contestUrl('own_round')),
        sessions.organizer,
      )
        .send({ name: 'Renamed' })
        .expect(200);
      await authed(
        api.http().patch(contestUrl('others_round')),
        sessions.organizer,
      )
        .send({ name: 'Hijacked' })
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('a user without rights edits no contest', async () => {
      await authed(
        api.http().patch(contestUrl('others_round')),
        sessions.nobody,
      )
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('editable=true lists only the contests the viewer may edit', async () => {
      const list = (who: string) =>
        authed(
          api.http().get(CONTESTS).query({ editable: 'true' }),
          sessions[who],
        ).expect(200);
      expect(listed(await list('organizer'), 'key')).toEqual(['own_round']);
      expect(listed(await list('nobody'), 'key')).toEqual([]);
    });
  });

  describe('organizations', () => {
    it('an organization admin edits their own organization but not another', async () => {
      await authed(api.http().patch(organizationUrl('mine')), sessions.orgAdmin)
        .send({ name: 'Renamed' })
        .expect(200);
      await authed(
        api.http().patch(organizationUrl('theirs')),
        sessions.orgAdmin,
      )
        .send({ name: 'Hijacked' })
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('an organization admin cannot change the staff fields of their own organization', async () => {
      await authed(api.http().patch(organizationUrl('mine')), sessions.orgAdmin)
        .send({ isUnlisted: true })
        .expect(403)
        .expect(errorCode('forbidden'));
    });

    it('a user without rights edits no organization', async () => {
      await authed(api.http().patch(organizationUrl('mine')), sessions.nobody)
        .send({ name: 'Hijacked' })
        .expect(403);
    });

    it('administered=true lists only the organizations the viewer may administer', async () => {
      const list = (who: string, administered: boolean) =>
        authed(
          api
            .http()
            .get(ORGANIZATIONS)
            .query({ administered: String(administered) }),
          sessions[who],
        ).expect(200);
      expect(listed(await list('orgAdmin', true), 'slug')).toEqual(['mine']);
      expect(listed(await list('orgAdmin', false), 'slug')).toEqual(['theirs']);
      expect(listed(await list('orgEditor', true), 'slug').sort()).toEqual([
        'mine',
        'theirs',
      ]);
      expect(listed(await list('nobody', true), 'slug')).toEqual([]);
    });
  });
});
