import { canonicalJson } from '@libs/common';
import { loadDocument } from './openapi/document';
import { ApiTest, setupApiTest } from './setup';

describe('OpenAPI document', () => {
  let api: ApiTest;
  beforeAll(async () => {
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  describe('response schemas', () => {
    type Schema = {
      $ref?: string;
      properties?: Record<string, Schema>;
      format?: string;
      items?: Schema;
      required?: string[];
      nullable?: boolean;
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
      // The package zip (application/zip); its 202 is documented on the route.
      'GET /api/internal/problems/{code}/package 200',
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
      const operation = doc.paths['/api/internal/feeds/{kind}/{format}'].get;
      expect(operation['x-raw']).toBe(true);
      expect(
        bodyOf(doc, '/api/internal/feeds/{kind}/{format}')?.required,
      ).not.toEqual(['data']);
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
              !response.content?.['text/event-stream']?.schema &&
              !response.content?.['application/x-ndjson']?.schema &&
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

  it('is the same document the offline emit builds', async () => {
    const served: unknown = (
      await api.http().get('/api/internal/openapi.json').expect(200)
    ).body;
    expect(canonicalJson(served)).toBe(canonicalJson(await loadDocument()));
  });
});
