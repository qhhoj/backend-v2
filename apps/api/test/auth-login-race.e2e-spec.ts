import { loginAs } from './problem-fixtures';
import { ApiTest, createUser, setupApiTest } from './setup';

const AUTH = '/api/internal/auth';
const OLD_PASSWORD = 'correct horse battery';

describe('a login in flight while every session of the user is signed out', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  const signOuts = {
    'sign out everywhere': (owner: { cookie: string; csrf: string }) =>
      api
        .http()
        .post(`${AUTH}/logout-all`)
        .set('Cookie', owner.cookie)
        .set('X-CSRF-Token', owner.csrf)
        .expect(204),
    'a password change': (owner: { cookie: string; csrf: string }) =>
      api
        .http()
        .post(`${AUTH}/password/change`)
        .set('Cookie', owner.cookie)
        .set('X-CSRF-Token', owner.csrf)
        .send({
          currentPassword: OLD_PASSWORD,
          newPassword: 'brand new passphrase',
        })
        .expect(204),
  };

  it.each(Object.keys(signOuts) as (keyof typeof signOuts)[])(
    'leaves no session behind after %s',
    async (name) => {
      const { _id } = await createUser(api.users, {
        username: name.replace(/\W/g, ''),
        email: `${name.replace(/\W/g, '')}@example.com`,
      });
      const owner = await loginAs(api, _id);
      const create = api.sessions.create.bind(api.sessions);
      let reachCreate!: () => void;
      let resumeCreate!: () => void;
      const reached = new Promise<void>((resolve) => (reachCreate = resolve));
      const resumed = new Promise<void>((resolve) => (resumeCreate = resolve));
      let openedId = '';
      const spy = jest
        .spyOn(api.sessions, 'create')
        .mockImplementationOnce(async (data) => {
          reachCreate();
          await resumed;
          const opened = await create(data);
          openedId = opened.id;
          return opened;
        });
      try {
        const inFlight = api
          .http()
          .post(`${AUTH}/login`)
          .send({
            username: name.replace(/\W/g, ''),
            password: OLD_PASSWORD,
          })
          .then((response) => response);
        await reached;
        await signOuts[name](owner);
        resumeCreate();
        const login = await inFlight;
        expect(login.status).toBe(401);
        expect(login.headers['set-cookie']).toBeUndefined();
        expect(openedId).not.toBe('');
        expect(await api.sessions.get(openedId)).toBeNull();
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('refuses a login whose user read predates a password change that lands before its epoch read', async () => {
    const { _id } = await createUser(api.users, {
      username: 'gapuser',
      email: 'gapuser@example.com',
    });
    const owner = await loginAs(api, _id);
    const readEpoch = api.sessions.signOutEpoch.bind(api.sessions);
    const spy = jest
      .spyOn(api.sessions, 'signOutEpoch')
      .mockImplementationOnce(async (userId) => {
        await signOuts['a password change'](owner);
        return readEpoch(userId);
      });
    try {
      const login = await api
        .http()
        .post(`${AUTH}/login`)
        .send({ username: 'gapuser', password: OLD_PASSWORD });
      expect(login.status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });
});
