import { ApiTest, setupApiTest } from './setup';

describe('OpenAPI document', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('is served publicly and lists the auth endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(body.openapi).toMatch(/^3\./);
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/auth/login',
        '/api/internal/auth/me',
        '/api/internal/auth/logout',
        '/api/internal/auth/logout-all',
        '/api/internal/auth/password/change',
        '/api/internal/auth/token/regenerate',
        '/api/internal/auth/register',
        '/api/internal/auth/activate',
        '/api/internal/auth/password/reset',
        '/api/internal/auth/password/reset/confirm',
        '/api/internal/auth/2fa/totp/enroll',
        '/api/internal/auth/2fa/totp/confirm',
        '/api/internal/auth/2fa/totp/verify',
        '/api/internal/auth/2fa/totp/disable',
        '/api/internal/auth/2fa/totp/scratch-codes',
        '/api/internal/auth/2fa/webauthn/register/options',
        '/api/internal/auth/2fa/webauthn/register/verify',
        '/api/internal/auth/2fa/webauthn/login/options',
        '/api/internal/auth/2fa/webauthn/login/verify',
        '/api/internal/auth/2fa/webauthn/credentials/{credentialId}',
        '/api/internal/auth/social/{provider}/start',
        '/api/internal/auth/social/{provider}/callback',
        '/api/internal/auth/social/complete',
        '/api/internal/auth/impersonate/{userId}',
        '/api/internal/auth/impersonate/stop',
      ]),
    );
  });
});
