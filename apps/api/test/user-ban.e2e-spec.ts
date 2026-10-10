import { CONTEST_CHEATING_BAN_REASON } from '../src/modules/contests/participation/contest-participation.service';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('ban and unban', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('signs a banned user out at once, unlists them, and unban restores them', async () => {
    const moderator = await loginAs(
      api,
      (
        await createUserWith(api, 'moderator', {
          permissions: ['judge.ban_user'],
        })
      )._id,
    );
    const target = await createUserWith(api, 'target', { displayRank: 'user' });
    const targetSession = await loginAs(api, target._id);
    await authed(api.http().get('/api/internal/profile'), targetSession).expect(
      200,
    );
    await authed(api.http().post('/api/internal/users/target/ban'), moderator)
      .send({ reason: 'spam' })
      .expect(204);
    await authed(api.http().get('/api/internal/profile'), targetSession).expect(
      401,
    );
    expect(await api.users.findById(target._id).lean()).toMatchObject({
      banReason: 'spam',
      displayRank: 'banned',
      isUnlisted: true,
      isActive: false,
    });
    await authed(api.http().post('/api/internal/users/target/ban'), moderator)
      .send({ reason: 'again' })
      .expect(409);
    const login = () =>
      api
        .http()
        .post('/api/internal/auth/login')
        .send({ username: 'target', password: 'correct horse battery' });
    expect((await login()).status).toBe(403);
    await authed(
      api.http().post('/api/internal/users/target/unban'),
      moderator,
    ).expect(204);
    expect(await api.users.findById(target._id).lean()).toMatchObject({
      banReason: null,
      displayRank: 'user',
      isUnlisted: false,
      isActive: true,
    });
    expect((await login()).status).toBe(200);
    await authed(
      api.http().post('/api/internal/users/target/unban'),
      moderator,
    ).expect(409);
  });

  it('never bans yourself, a superuser, or without ban_user', async () => {
    const moderator = await createUserWith(api, 'moderator2', {
      permissions: ['judge.ban_user'],
    });
    const session = await loginAs(api, moderator._id);
    await createUserWith(api, 'root', { isSuperuser: true });
    await authed(api.http().post('/api/internal/users/moderator2/ban'), session)
      .send({ reason: 'x' })
      .expect(403);
    await authed(api.http().post('/api/internal/users/root/ban'), session)
      .send({ reason: 'x' })
      .expect(403);
    await authed(api.http().post('/api/internal/users/nobody/ban'), session)
      .send({ reason: CONTEST_CHEATING_BAN_REASON })
      .expect(400);
    await authed(api.http().post('/api/internal/users/nobody/ban'), session)
      .send({ reason: 'x' })
      .expect(404);
    await authed(api.http().post('/api/internal/users/root/ban'), session)
      .send({ reason: '' })
      .expect(400);
    const plain = await loginAs(api, (await createUserWith(api, 'plain'))._id);
    await authed(api.http().post('/api/internal/users/moderator2/ban'), plain)
      .send({ reason: 'x' })
      .expect(403);
  });

  it('resets two-factor for staff only, never a superuser, signs the user out and leaves an audit row', async () => {
    const staff = await loginAs(
      api,
      (
        await createUserWith(api, 'recovery', {
          permissions: ['judge.ban_user'],
        })
      )._id,
    );
    const locked = await createUserWith(api, 'locked', {
      isTotpEnabled: true,
      totpKey: 'secret',
      scratchCodes: 'codes',
      isWebauthnEnabled: true,
      webauthnCredentials: [
        {
          _id: '01900000-0000-7000-8000-0000000000bb',
          name: 'key',
          credId: 'AA',
          publicKey: 'AA',
          counter: 0,
        },
      ],
    });
    const lockedSession = await loginAs(api, locked._id);
    const reset = (name: string, session = staff) =>
      authed(
        api.http().post(`/api/internal/users/${name}/reset-two-factor`),
        session,
      );
    await reset(
      'locked',
      await loginAs(api, (await createUserWith(api, 'plain2'))._id),
    ).expect(403);
    await reset('locked').expect(204);
    expect(await api.users.findById(locked._id).lean()).toMatchObject({
      isTotpEnabled: false,
      totpKey: null,
      scratchCodes: null,
      isWebauthnEnabled: false,
      webauthnCredentials: [],
    });
    await authed(api.http().get('/api/internal/profile'), lockedSession).expect(
      401,
    );
    expect(
      await api.revisions.countDocuments({
        entity: 'user',
        entityId: locked._id,
        action: 'reset_two_factor',
      }),
    ).toBe(1);
    await createUserWith(api, 'boss', { isSuperuser: true });
    await reset('boss').expect(403);
  });
});
