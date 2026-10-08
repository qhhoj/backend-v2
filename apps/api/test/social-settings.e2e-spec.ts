import { setupApiTest, errorCode, ApiTest } from './setup';

const SOCIAL = '/api/internal/auth/social';
const GITHUB = {
  enabled: true,
  clientId: 'gh-client',
  clientSecret: 'gh-secret',
};

/** The real OAuthProvidersService: no fake, the admin settings decide which providers exist. */
describe('social login from settings', () => {
  let api: ApiTest;

  const listed = async () =>
    (
      (await api.http().get(`${SOCIAL}/providers`).expect(200)).body as {
        data: { providers: string[] };
      }
    ).data.providers;

  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('lists github and starts the login once an admin enables it, and refuses it once disabled', async () => {
    expect(await listed()).toEqual([]);

    await api.setSetting('auth.github', GITHUB);
    expect(await listed()).toEqual(['github']);
    const start = await api.http().get(`${SOCIAL}/github/start`).expect(302);
    expect(start.headers.location).toMatch(
      /^https:\/\/github\.com\/login\/oauth\/authorize\?/,
    );
    expect(start.headers.location).toContain('client_id=gh-client');

    await api.setSetting('auth.github', { ...GITHUB, enabled: false });
    expect(await listed()).toEqual([]);
    await api
      .http()
      .get(`${SOCIAL}/github/start`)
      .expect(404)
      .expect(errorCode('not_found'));
    await api
      .http()
      .get(`${SOCIAL}/github/callback?code=c&state=s`)
      .expect(404)
      .expect(errorCode('not_found'));
  });
});
