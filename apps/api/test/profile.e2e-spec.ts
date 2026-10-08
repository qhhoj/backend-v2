import { Queue as BullQueue } from 'bullmq';
import { ORGANIZATION_POINTS_JOB } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type { ProfileResponse } from '../src/modules/users/profile/dto/profile.response';
import type { SessionResponse } from '../src/modules/auth/core/dto/session.response';
import { createOrganization } from './organization-fixtures';
import {
  authed,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('profile', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let userCount = 0;
  const person = async (extra: Partial<User> = {}) => {
    userCount += 1;
    const user = await createUserWith(api, `profile${userCount}`, extra);
    const session = await loginAs(api, user._id);
    return {
      user,
      patch: (body: object) =>
        authed(api.http().patch('/api/internal/profile'), session).send(body),
      get: () => authed(api.http().get('/api/internal/profile'), session),
    };
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
  });
  afterAll(() => api.teardown());

  it('stores about as escaped HTML for users with five solved problems', async () => {
    const { patch } = await person({ problemCount: 5 });
    const profile = dataOf<ProfileResponse>(
      await patch({ about: 'Hi <img src=x onerror=alert(1)>' }).expect(200),
    );
    expect(profile.about).toBe('Hi <img src=x onerror=alert(1)>');
    expect(profile.aboutHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(profile.aboutHtml).not.toContain('<img');
  });

  it('gates about on five solved problems or staff, and on not being muted', async () => {
    await (await person({ problemCount: 4 })).patch({ about: 'x' }).expect(403);
    await (await person({ isStaff: true })).patch({ about: 'x' }).expect(200);
    await (
      await person({ problemCount: 50, mute: true })
    )
      .patch({ about: 'x' })
      .expect(403);
    const newcomer = await person({ problemCount: 0, about: 'kept' });
    await newcomer
      .patch({ about: 'kept', timezone: 'Asia/Ho_Chi_Minh' })
      .expect(200);
  });

  it('checks the about gate before the language and badge references', async () => {
    const unknownId = (await person()).user._id;
    const { patch } = await person({ problemCount: 4 });
    await patch({ about: 'x', languageId: unknownId }).expect(403);
  });

  it('reports the language before the badge when both references are unknown', async () => {
    const unknownId = (await person()).user._id;
    const { patch } = await person();
    const { body } = (await patch({
      languageId: unknownId,
      displayBadgeId: unknownId,
    }).expect(400)) as {
      body: { error: { fields: Record<string, string[]> } };
    };
    expect(Object.keys(body.error.fields)).toEqual(['languageId']);
  });

  it('trims the full name, caps it at 30 characters and returns it', async () => {
    const { patch } = await person();
    const profile = dataOf<ProfileResponse>(
      await patch({ firstName: '  Ada  ' }).expect(200),
    );
    expect(profile.firstName).toBe('Ada');
    await patch({ firstName: 'x'.repeat(31) }).expect(400);
  });

  it('validates the time zone, language, themes and badge', async () => {
    const badge = (await person()).user._id;
    const { patch } = await person({ badges: [badge] });
    await patch({ timezone: 'Mars/Base' }).expect(400);
    await patch({ languageId: badge }).expect(400);
    await patch({ aceTheme: 'neon' }).expect(400);
    for (const siteTheme of ['glass', 'auto'])
      await patch({ siteTheme }).expect(200);
    for (const siteTheme of ['Dark', '1x', 'a b', 'a'.repeat(33), ''])
      await patch({ siteTheme }).expect(400);
    await patch({ displayBadgeId: (await person()).user._id }).expect(400);
    const profile = dataOf<ProfileResponse>(
      await patch({
        timezone: 'America/Toronto',
        languageId: catalog.languages.python,
        aceTheme: 'monokai',
        siteTheme: 'dark',
        mathEngine: 'jax',
        displayBadgeId: badge,
        userScript: 'x',
      }).expect(200),
    );
    expect(profile).toMatchObject({
      timezone: 'America/Toronto',
      languageId: catalog.languages.python,
      aceTheme: 'monokai',
      siteTheme: 'dark',
      mathEngine: 'jax',
      displayBadgeId: badge,
    });
  });

  it('answers a stable issue code for each reference the user cannot set', async () => {
    const issuesOf = async (body: object) => {
      const { body: response } = (await (
        await person()
      )
        .patch(body)
        .expect(400)) as {
        body: { error: { issues: Array<{ field: string; code: string }> } };
      };
      return response.error.issues.map(({ field, code }) => `${field}:${code}`);
    };
    const stranger = (await person()).user._id;
    const outsider = await createOrganization(api, {});
    expect(await issuesOf({ languageId: stranger })).toEqual([
      'languageId:unknown_language',
    ]);
    expect(await issuesOf({ displayBadgeId: stranger })).toEqual([
      'displayBadgeId:not_your_badge',
    ]);
    expect(await issuesOf({ organizations: [outsider._id] })).toEqual([
      'organizations:organizations_not_editable',
    ]);
  });

  it('stores a personal appearance, returns it, replaces it as a whole and clears it with null', async () => {
    const { user, patch, get } = await person();
    expect(
      dataOf<ProfileResponse>(await get().expect(200)).appearance,
    ).toBeNull();

    const saved = dataOf<ProfileResponse>(
      await patch({
        appearance: { accent: 'ocean', glass: 30, glow: 100 },
      }).expect(200),
    );
    expect(saved.appearance).toEqual({ accent: 'ocean', glass: 30, glow: 100 });
    expect((await api.users.findOne({ _id: user._id }))!.appearance).toEqual({
      accent: 'ocean',
      glass: 30,
      glow: 100,
    });

    // Another field leaves it alone.
    const untouched = dataOf<ProfileResponse>(
      await patch({ siteTheme: 'dark' }).expect(200),
    );
    expect(untouched.appearance).toEqual({
      accent: 'ocean',
      glass: 30,
      glow: 100,
    });

    // A new object replaces the old one, boundaries included.
    const replaced = dataOf<ProfileResponse>(
      await patch({
        appearance: { accent: 'mono', glass: 0, glow: 0 },
      }).expect(200),
    );
    expect(replaced.appearance).toEqual({ accent: 'mono', glass: 0, glow: 0 });
    const edge = dataOf<ProfileResponse>(
      await patch({
        appearance: { accent: 'gold', glass: 100, glow: 100 },
      }).expect(200),
    );
    expect(edge.appearance).toEqual({ accent: 'gold', glass: 100, glow: 100 });

    // null is the one way back to the site's look; mode (siteTheme) is not part of it.
    const cleared = dataOf<ProfileResponse>(
      await patch({ appearance: null }).expect(200),
    );
    expect(cleared.appearance).toBeNull();
    expect(cleared.siteTheme).toBe('dark');
  });

  it('answers appearance null on the profile and the session for a user document without the field', async () => {
    const { user, get } = await person({
      appearance: { accent: 'ocean', glass: 30, glow: 70 },
    });
    await api.users.updateOne(
      { _id: user._id },
      { $unset: { appearance: '' } },
    );
    expect(
      await api.users.findOne({ _id: user._id }).lean(),
    ).not.toHaveProperty('appearance');

    expect(
      dataOf<ProfileResponse>(await get().expect(200)).appearance,
    ).toBeNull();
    const me = await authed(
      api.http().get('/api/internal/auth/me'),
      await loginAs(api, user._id),
    ).expect(200);
    expect(dataOf<SessionResponse>(me).user?.appearance).toBeNull();
  });

  it('refuses an invalid appearance with a field code and stores nothing', async () => {
    const { user, patch } = await person({
      appearance: { accent: 'mint', glass: 10, glow: 20 },
    });
    const issuesOf = async (appearance: unknown) => {
      const response = await patch({ appearance }).expect(400);
      const { error } = response.body as {
        error: {
          code: string;
          fields: Record<string, string[]>;
          issues: Array<{ field: string; code: string }>;
        };
      };
      expect(error.code).toBe('validation_failed');
      return error.issues.map(({ field, code }) => `${field}:${code}`);
    };
    expect(await issuesOf({ accent: 'violet', glass: 10, glow: 20 })).toContain(
      'appearance.accent:is_in',
    );
    expect(await issuesOf({ accent: 'mint', glass: 101, glow: 20 })).toContain(
      'appearance.glass:max',
    );
    expect(await issuesOf({ accent: 'mint', glass: -1, glow: 20 })).toContain(
      'appearance.glass:min',
    );
    expect(
      await issuesOf({ accent: 'mint', glass: 10, glow: 100.5 }),
    ).toContain('appearance.glow:is_int');
    expect(await issuesOf({ accent: 'mint', glass: '10', glow: 20 })).toContain(
      'appearance.glass:is_int',
    );
    expect(await issuesOf({ accent: 'mint', glass: 10 })).toContain(
      'appearance.glow:is_int',
    );
    expect(
      await issuesOf({ accent: 'mint', glass: 10, glow: 20, hue: 300 }),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining('appearance.hue')]),
    );
    expect(await issuesOf('ocean')).toEqual(
      expect.arrayContaining([expect.stringContaining('appearance')]),
    );
    expect(await issuesOf([])).toEqual(
      expect.arrayContaining([expect.stringContaining('appearance')]),
    );
    expect((await api.users.findOne({ _id: user._id }))!.appearance).toEqual({
      accent: 'mint',
      glass: 10,
      glow: 20,
    });
  });

  it('refuses null on every field but the badge, which null clears', async () => {
    const badge = (await person()).user._id;
    const { patch } = await person({ badges: [badge], displayBadgeId: badge });
    for (const field of [
      'about',
      'timezone',
      'languageId',
      'aceTheme',
      'userScript',
      'organizations',
    ])
      await patch({ [field]: null }).expect(400);
    expect(
      dataOf<ProfileResponse>(await patch({ displayBadgeId: null }).expect(200))
        .displayBadgeId,
    ).toBeNull();
  });

  it('reorders and leaves organizations, never adds one, never drops one it administers', async () => {
    const { user, patch } = await person();
    const [first, second, third] = [
      await createOrganization(api, {}, [user._id]),
      await createOrganization(api, {}, [user._id]),
      await createOrganization(api, { adminIds: [user._id] }),
    ];
    const reordered = dataOf<ProfileResponse>(
      await patch({ organizations: [second._id, first._id, third._id] }).expect(
        200,
      ),
    );
    expect(reordered.organizations.map((row) => row.id)).toEqual([
      second._id,
      first._id,
      third._id,
    ]);
    await patch({
      organizations: [
        second._id,
        first._id,
        third._id,
        (await createOrganization(api, { isOpen: false }))._id,
      ],
    }).expect(400);
    await patch({ organizations: [second._id, first._id] }).expect(409);
    const addBulk = jest.spyOn(BullQueue.prototype, 'addBulk');
    try {
      await patch({ organizations: [third._id] }).expect(200);
      const queued = addBulk.mock.calls
        .flatMap(([jobs]) => jobs)
        .filter((job) => job.name === ORGANIZATION_POINTS_JOB)
        .map((job) => (job.data as OrganizationPointsJob).organizationId);
      expect(queued.sort()).toEqual([first._id, second._id].sort());
    } finally {
      addBulk.mockRestore();
    }
    expect(
      (await api.users.findById(user._id).lean())!.organizations.map(uuidStr),
    ).toEqual([third._id]);
  });

  it('reads its own settings', async () => {
    const { get } = await person({ timezone: 'UTC', userScript: 'script' });
    expect(dataOf<ProfileResponse>(await get().expect(200))).toMatchObject({
      timezone: 'UTC',
      userScript: 'script',
    });
    await api.http().get('/api/internal/profile').expect(401);
  });
});

describe('profile in official contest mode', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
    await api.setSetting('contest.officialMode', true);
  });
  afterAll(() => api.teardown());

  it('locks a changed full name, but not one that is unchanged once trimmed', async () => {
    const namer = await createUserWith(api, 'namer', {
      problemCount: 100,
      firstName: 'Ada',
    });
    const session = await loginAs(api, namer._id);
    const patch = (body: object) =>
      authed(api.http().patch('/api/internal/profile'), session).send(body);
    await patch({ firstName: '  Ada  ' }).expect(200);
    await patch({ firstName: 'Grace' }).expect(403);
  });

  it('refuses about edits to everyone but superusers', async () => {
    const solver = await createUserWith(api, 'solver', { problemCount: 100 });
    await authed(
      api.http().patch('/api/internal/profile'),
      await loginAs(api, solver._id),
    )
      .send({ about: 'x' })
      .expect(403);
    await authed(
      api.http().patch('/api/internal/profile'),
      await loginAs(api, solver._id),
    )
      .send({ timezone: 'UTC' })
      .expect(200);
    const root = await createUserWith(api, 'root', { isSuperuser: true });
    await authed(
      api.http().patch('/api/internal/profile'),
      await loginAs(api, root._id),
    )
      .send({ about: 'x' })
      .expect(200);
  });
});
