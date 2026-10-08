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
        '/api/internal/problems/{code}/submit/file',
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

  it('lists the realtime and legacy submission endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/events/submissions',
        '/api/internal/events/submissions/{id}',
        '/api/v2/submissions',
        '/api/v2/submission/{id}',
      ]),
    );
  });

  it('lists the contest endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/contests',
        '/api/internal/contests/current',
        '/api/internal/contests/{key}',
        '/api/internal/contests/{key}/register',
        '/api/internal/contests/{key}/join',
        '/api/internal/contests/{key}/leave',
        '/api/internal/contests/{key}/participations',
        '/api/internal/contests/{key}/participations/{id}/disqualify',
        '/api/internal/contests/{key}/ranking',
        '/api/internal/contests/{key}/submissions',
        '/api/internal/contests/{key}/rescore',
        '/api/internal/contests/{key}/judge-final',
      ]),
    );
  });

  it('lists the contest extras', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/contests/{key}/rate',
        '/api/internal/contests/{key}/ranking-link',
        '/api/internal/contests/{key}/ranking-link/regenerate',
        '/api/internal/public-rankings/{token}',
        '/api/internal/contests/{key}/official-ranking',
        '/api/internal/contests/{key}/announcements',
        '/api/internal/contests/{key}/announcements/{id}',
        '/api/internal/contests/{key}/announcements/{id}/resend',
        '/api/internal/events/contests/{key}',
        '/api/internal/contests/{key}/stats',
        '/api/internal/contests/{key}/moss',
        '/api/internal/contests/{key}/data',
        '/api/internal/contests/{key}/data/download',
        '/api/internal/contests/{key}/clone',
        '/api/v2/contests',
        '/api/v2/contest/{key}',
        '/api/v2/participations',
      ]),
    );
  });

  it('lists the organization and user endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/organizations',
        '/api/internal/organizations/{slug}',
        '/api/internal/organizations/{slug}/members',
        '/api/internal/organizations/{slug}/join',
        '/api/internal/organizations/{slug}/leave',
        '/api/internal/organizations/{slug}/kick',
        '/api/internal/organizations/{slug}/requests',
        '/api/internal/organizations/{slug}/requests/{id}',
        '/api/internal/organizations/{slug}/requests/{id}/decide',
        '/api/internal/users',
        '/api/internal/contributors',
        '/api/internal/users/{username}',
        '/api/internal/users/{username}/ratings',
        '/api/internal/users/{username}/solved',
        '/api/internal/users/{username}/pp-breakdown',
        '/api/internal/users/{username}/activity',
        '/api/internal/users/{username}/rank',
        '/api/internal/users/{username}/ban',
        '/api/internal/users/{username}/unban',
        '/api/internal/profile',
        '/api/internal/profile/data',
        '/api/internal/profile/data/download',
        '/api/v2/organizations',
        '/api/v2/users',
        '/api/v2/user/{username}',
      ]),
    );
  });

  it('lists the blog, comment, homepage and feed endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/posts',
        '/api/internal/posts/{id}',
        '/api/internal/posts/{id}/vote',
        '/api/internal/organizations/{slug}/posts',
        '/api/internal/users/{username}/blog',
        '/api/internal/users/{username}/comments',
        '/api/internal/comments/pages/{type}/{key}',
        '/api/internal/comments/pages/{type}/{key}/lock',
        '/api/internal/comments/{id}',
        '/api/internal/comments/{id}/revisions',
        '/api/internal/comments/{id}/vote',
        '/api/internal/comments/{id}/hidden',
        '/api/internal/comments/{id}/votes',
        '/api/internal/home',
        '/api/internal/feeds/{kind}/{format}',
      ]),
    );
  });
});
