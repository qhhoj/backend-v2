import { loginAs } from './problem-fixtures';
import { ApiTest, createUser, setupApiTest } from './setup';

const AUTH = '/api/internal/auth';
const OLD_PASSWORD = 'correct horse battery';

describe('a login in flight while the password changes', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('does not leave a session that outlives the change', async () => {
    const { _id } = await createUser(api.users, {});
    const owner = await loginAs(api, _id);
    const create = api.sessions.create.bind(api.sessions);
    let reachCreate!: () => void;
    let resumeCreate!: () => void;
    const reached = new Promise<void>((resolve) => (reachCreate = resolve));
    const resumed = new Promise<void>((resolve) => (resumeCreate = resolve));
    const spy = jest
      .spyOn(api.sessions, 'create')
      .mockImplementationOnce(async (data) => {
        reachCreate();
        await resumed;
        return create(data);
      });
    try {
      const inFlight = api
        .http()
        .post(`${AUTH}/login`)
        .send({ username: 'alice', password: OLD_PASSWORD })
        .then((response) => response);
      await reached;
      await api
        .http()
        .post(`${AUTH}/password/change`)
        .set('Cookie', owner.cookie)
        .set('X-CSRF-Token', owner.csrf)
        .send({
          currentPassword: OLD_PASSWORD,
          newPassword: 'brand new passphrase',
        })
        .expect(204);
      resumeCreate();
      const login = await inFlight;
      expect(login.status).toBe(401);
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      const me = await api.http().get(`${AUTH}/me`).set('Cookie', cookie);
      expect(me.status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });
});
