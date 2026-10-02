import { ApiTest, setupApiTest } from './setup';

describe('GET /healthz', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('returns ok', () =>
    api
      .http()
      .get('/healthz')
      .expect(200, { data: { status: 'ok' } }));
});
