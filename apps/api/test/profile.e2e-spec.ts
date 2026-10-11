import { Queue as BullQueue } from 'bullmq';
import { ORGANIZATION_POINTS_JOB } from '@libs/community';
import type { OrganizationPointsJob } from '@libs/community';
import { uuidStr } from '@libs/database';
import type { User } from '@libs/database';
import type { ProfileResponse } from '../src/modules/users/profile/dto/profile.response';
import { createOrganization } from './organization-fixtures';
import {
  authed,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('profile', () => {
  let api: ApiTest;
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
    await seedCatalog(api);
  });
  afterAll(() => api.teardown());

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
});
