import { ApiTest, setupApiTest } from './setup';

describe('API reference (/api/docs)', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('redirects /api/docs to the trailing-slash page', () =>
    api.http().get('/api/docs').expect(301).expect('location', '/api/docs/'));

  it('serves the Scalar reference pointing at the relative OpenAPI url', async () => {
    const response = await api.http().get('/api/docs/').expect(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('QHHOJ API');
    expect(response.text).toContain('/api/internal/openapi.json');
    expect(response.text).not.toMatch(/(src|href)="https?:\/\//);
    const script = /<script[^>]*src="([^"]+)"/.exec(response.text)?.[1];
    expect(script).toBe('js/scalar.js');
    await api.http().get('/api/docs/js/scalar.js').expect(200);
  });

  it('still serves the OpenAPI document it renders', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    expect((response.body as { openapi: string }).openapi).toMatch(/^3\./);
  });
});
