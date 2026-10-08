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
        '/api/internal/auth/2fa/webauthn/credentials',
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
        '/api/internal/contests/{key}/data',
        '/api/internal/contests/{key}/data/download',
        '/api/internal/contests/{key}/clone',
        '/api/v2/contests',
        '/api/v2/contest/{key}',
        '/api/v2/participations',
      ]),
    );
  });

  it('lists the similarity routes', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/similarity/runs',
        '/api/internal/similarity/runs/{runId}',
        '/api/internal/similarity/runs/{runId}/pairs',
        '/api/internal/similarity/pairs/{pairId}',
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

  it('lists the site content endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/site',
        '/api/internal/pages/{path}',
        '/api/internal/admin/site/pages',
        '/api/internal/admin/site/pages/{id}',
        '/api/internal/admin/site/navigation',
        '/api/internal/admin/site/navigation/{id}',
        '/api/internal/admin/site/config/{key}',
      ]),
    );
  });

  it('lists the ticket and user activity endpoints', async () => {
    const response = await api
      .http()
      .get('/api/internal/openapi.json')
      .expect(200);
    const body = response.body as { paths: Record<string, unknown> };
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/tickets',
        '/api/internal/tickets/{id}',
        '/api/internal/tickets/{id}/messages',
        '/api/internal/tickets/general',
        '/api/internal/problems/{code}/tickets',
        '/api/internal/events/tickets',
        '/api/internal/events/tickets/{id}',
        '/api/internal/admin/user-activity/logs',
        '/api/internal/admin/user-activity/logs/export',
        '/api/internal/admin/user-activity/users/{username}/logs',
        '/api/internal/admin/user-activity/users/{username}/summary',
        '/api/internal/admin/user-activity/users/{username}',
        '/api/internal/admin/user-activity/anonymous',
        '/api/internal/admin/user-activity/live',
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

  describe('response schemas', () => {
    it("documents the viewer's own result on each detail problem", async () => {
      const { schemas } = (await document()).components;
      expect(Object.keys(schemas.ContestProblemResponse.properties!)).toEqual(
        expect.arrayContaining(['viewerResult']),
      );
      expect(
        Object.keys(schemas.ContestProblemViewerResultResponse.properties!),
      ).toEqual(
        expect.arrayContaining([
          'cell',
          'isSolved',
          'attempts',
          'hasPendingSubmission',
        ]),
      );
    });

    type Schema = {
      $ref?: string;
      properties?: Record<string, Schema>;
      format?: string;
      items?: Schema;
      required?: string[];
    };
    type Operation = {
      requestBody?: { content: Record<string, { schema: Schema }> };
      responses: Record<
        string,
        { content?: Record<string, { schema?: Schema }> }
      >;
      [extension: string]: unknown;
    };
    type Doc = {
      paths: Record<string, Record<string, Operation>>;
      components: { schemas: Record<string, Schema> };
    };
    const document = async () =>
      (await api.http().get('/api/internal/openapi.json').expect(200))
        .body as Doc;
    const bodyOf = (doc: Doc, path: string, method = 'get', status = '200') =>
      doc.paths[path][method].responses[status].content?.['application/json']
        ?.schema;

    /** Success responses that carry no JSON schema on purpose (files, streams, empty bodies). */
    const UNDOCUMENTED_BODY = new Set<string>([
      // Redirects (`@Res()`, 302 to the provider or back to the app), no JSON body.
      'GET /api/internal/auth/social/{provider}/start 200',
      'GET /api/internal/auth/social/{provider}/callback 200',
      // The PDF itself (application/pdf); its 202 and 503 are documented on the route.
      'GET /api/internal/problems/{code}/pdf 200',
      // Server-sent event streams (text/event-stream), not JSON.
      'GET /api/internal/events/submissions 200',
      'GET /api/internal/events/submissions/{id} 200',
      'GET /api/internal/events/tickets 200',
      'GET /api/internal/events/tickets/{id} 200',
      'GET /api/internal/events/contests/{key} 200',
    ]);

    it('documents the session response inside the data envelope with its members', async () => {
      const doc = await document();
      const data = bodyOf(doc, '/api/internal/auth/me')!.properties!.data;
      const name = data.$ref!.split('/').pop()!;
      expect(Object.keys(doc.components.schemas[name].properties!)).toEqual(
        expect.arrayContaining([
          'user',
          'csrfToken',
          'twoFactorRequired',
          'twoFactor',
          'impersonatorId',
        ]),
      );
    });

    it('documents the security key list items as id and name only', async () => {
      const doc = await document();
      const items = bodyOf(doc, '/api/internal/auth/2fa/webauthn/credentials')!
        .properties!.data.items!;
      const name = items.$ref!.split('/').pop()!;
      expect(
        Object.keys(doc.components.schemas[name].properties!).sort(),
      ).toEqual(['id', 'name']);
    });

    it('types the appearance percentages as bounded integers', async () => {
      const { schemas } = (await document()).components;
      for (const name of ['AppearanceResponse', 'AppearanceDto'])
        for (const field of ['glass', 'glow'])
          expect(schemas[name].properties![field]).toMatchObject({
            type: 'integer',
            minimum: 0,
            maximum: 100,
          });
    });

    it('documents a paginated route as data[] plus meta', async () => {
      const doc = await document();
      const body = bodyOf(doc, '/api/internal/problems')!;
      expect(body.required).toEqual(['data', 'meta']);
      expect(body.properties!.data.items!.$ref).toContain(
        'ProblemListItemResponse',
      );
      expect(doc.components.schemas.PageMetaResponse.properties).toHaveProperty(
        'total',
      );
    });

    it('documents a has-more list with no total, and the CSV export as text/csv', async () => {
      const doc = await document();
      const logs = bodyOf(doc, '/api/internal/admin/user-activity/logs')!;
      expect(logs.properties!.meta.$ref).toContain('HasMorePageMetaResponse');
      expect(
        doc.components.schemas.HasMorePageMetaResponse.properties,
      ).toHaveProperty('hasMore');
      expect(
        doc.components.schemas.HasMorePageMetaResponse.properties,
      ).not.toHaveProperty('total');
      const exported =
        doc.paths['/api/internal/admin/user-activity/logs/export'].get;
      expect(exported.responses['200'].content).toHaveProperty('text/csv');
    });

    it('leaves a RawResponse route unwrapped', async () => {
      const doc = await document();
      const operation = doc.paths['/api/v2/problems'].get;
      expect(operation['x-raw']).toBe(true);
      expect(bodyOf(doc, '/api/v2/problems')?.required).not.toEqual(['data']);
    });

    it('documents the multipart body of the file submission', async () => {
      const doc = await document();
      const form =
        doc.paths['/api/internal/problems/{code}/submit/file'].post.requestBody!
          .content['multipart/form-data'].schema;
      expect(form.required).toEqual(
        expect.arrayContaining(['language', 'file']),
      );
      expect(form.properties!.file.format).toBe('binary');
    });

    it('documents registrationRequired on the public flatpage', async () => {
      const doc = await document();
      const data = bodyOf(doc, '/api/internal/pages/{path}')!.properties!.data;
      const name = data.$ref!.split('/').pop()!;
      expect(Object.keys(doc.components.schemas[name].properties!)).toEqual(
        expect.arrayContaining([
          'url',
          'title',
          'contentHtml',
          'registrationRequired',
        ]),
      );
    });

    it("documents the contest join rules and the viewer's state on list rows and the detail viewer", async () => {
      const { schemas } = (await document()).components;
      expect(Object.keys(schemas.ContestListItemResponse.properties!)).toEqual(
        expect.arrayContaining([
          'requiresAccessCode',
          'disallowVirtual',
          'registrationStart',
          'registrationEnd',
          'viewer',
        ]),
      );
      expect(
        schemas.ContestListViewerResponse.properties!.liveStatus,
      ).toMatchObject({
        enum: ['registered', 'participating', 'finished'],
        nullable: true,
      });
      expect(Object.keys(schemas.ContestViewerResponse.properties!)).toEqual(
        expect.arrayContaining([
          'liveStatus',
          'isCurrent',
          'canEdit',
          'liveParticipation',
        ]),
      );
      expect(Object.keys(schemas.ContestDetailResponse.properties!)).toEqual(
        expect.arrayContaining([
          'requiresAccessCode',
          'registrationStart',
          'problems',
        ]),
      );
    });

    it('documents the PDF outcomes: file, rendering with the envelope, and the error envelope', async () => {
      const doc = await document();
      const { responses } = doc.paths['/api/internal/problems/{code}/pdf'].get;
      expect(Object.keys(responses['200'].content!)).toEqual([
        'application/pdf',
      ]);
      expect(
        responses['202'].content!['application/json']?.schema?.required,
      ).toEqual(['data']);
      expect(
        responses['503'].content!['application/json']?.schema?.$ref,
      ).toContain('ErrorResponse');
    });

    it('documents the error envelope once, with its members', async () => {
      const doc = await document();
      const body = doc.components.schemas.ErrorBodyResponse;
      expect(Object.keys(body.properties!)).toEqual(
        expect.arrayContaining(['code', 'message', 'fields', 'issues']),
      );
      expect(body.required).toEqual(['code', 'message']);
    });

    it('types a setting value and revision before/after as any JSON value', async () => {
      const { schemas } = (await document()).components;
      const anyValueProperties = [
        schemas.SettingResponse.properties!.value,
        schemas.SettingRevisionResponse.properties!.before,
        schemas.SettingRevisionResponse.properties!.after,
      ];
      for (const property of anyValueProperties) {
        expect(property).toBeDefined();
        expect(property).not.toHaveProperty('type');
        expect(property).not.toHaveProperty('additionalProperties');
      }
    });

    it('has a response schema for every JSON route, except the listed ones', async () => {
      const doc = await document();
      const missing = Object.entries(doc.paths).flatMap(([path, methods]) =>
        Object.entries(methods).flatMap(([method, operation]) =>
          ['200', '201', '202'].flatMap((status) => {
            const response = operation.responses[status];
            return response &&
              !response.content?.['application/json']?.schema &&
              !operation['x-raw']
              ? [`${method.toUpperCase()} ${path} ${status}`]
              : [];
          }),
        ),
      );
      expect(missing.filter((route) => !UNDOCUMENTED_BODY.has(route))).toEqual(
        [],
      );
    });
  });
});
