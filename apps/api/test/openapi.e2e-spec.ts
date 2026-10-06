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

  it('lists the problem endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/problems',
        '/api/internal/problems/meta',
        '/api/internal/problems/{code}',
        '/api/internal/problems/{code}/editorial',
        '/api/internal/problems/suggest',
        '/api/internal/problems/{code}/clone',
        '/api/internal/problems/{code}/translations/{lang}',
        '/api/internal/problems/render-preview',
        '/api/internal/problems/uploads/image',
        '/api/internal/problems/{code}/statement',
        '/api/internal/problems/{code}/material',
        '/api/internal/problems/{code}/data',
        '/api/internal/problems/{code}/data/init',
        '/api/internal/problems/{code}/data/archive',
        '/api/internal/problems/{code}/data/files/{kind}',
        '/api/internal/problems/{code}/data/files/{name}',
        '/api/internal/problems/{code}/pdf',
        '/api/internal/problems/{code}/submit',
        '/api/internal/problems/imports',
        '/api/internal/problems/imports/{jobId}',
        '/api/internal/tags',
        '/api/internal/tags/catalog',
        '/api/internal/tags/{code}',
        '/api/internal/tags/{code}/assign',
        '/api/v2/problems',
        '/api/v2/problem/{code}',
      ]),
    );
  });

  it('lists the judging endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/problems/{code}/submit',
        '/api/internal/submissions',
        '/api/internal/submissions/rejudge',
        '/api/internal/submissions/{id}',
        '/api/internal/submissions/{id}/source',
        '/api/internal/submissions/{id}/abort',
        '/api/internal/submissions/{id}/rejudge',
        '/api/internal/submissions/{id}/reject',
        '/api/internal/judges',
        '/api/internal/judges/{name}',
        '/api/internal/judges/{name}/key',
        '/api/internal/judges/{name}/disconnect',
      ]),
    );
  });
});
