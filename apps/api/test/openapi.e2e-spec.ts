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
      ]),
    );
  });
});
