import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { signedInWriter } from '../community-fixtures';
import { authed, createUserWith } from '../problem-fixtures';
import { setupApiTest } from '../setup';
import type { ApiTest } from '../setup';
import { loadDocument } from './document';

/** Keys of the schema the route documents for `meta` (200 response, `$ref` into components). */
function documentedMetaKeys(document: OpenAPIObject, path: string): string[] {
  const operation = document.paths[path].get!;
  const body = (
    operation.responses['200'] as {
      content: Record<string, { schema: SchemaObject }>;
    }
  ).content['application/json'].schema;
  const ref = (body.properties!.meta as { $ref: string }).$ref;
  const schema = document.components!.schemas![ref.split('/').pop()!];
  return Object.keys((schema as SchemaObject).properties ?? {}).sort();
}

describe('paginated meta: documented shape equals the keys the route sends', () => {
  let api: ApiTest;
  let document: OpenAPIObject;
  beforeAll(async () => {
    [api, document] = await Promise.all([setupApiTest(), loadDocument()]);
  });
  afterAll(() => api.teardown());

  const sentKeys = (body: unknown) =>
    Object.keys((body as { meta: object }).meta).sort();

  it('GET /users/{username}/pp-breakdown sends {page, pageSize, hasMore}', async () => {
    await createUserWith(api, 'meta_pp', {});
    const response = await api
      .http()
      .get('/api/internal/users/meta_pp/pp-breakdown')
      .expect(200);
    const path = '/api/internal/users/{username}/pp-breakdown';
    expect(sentKeys(response.body)).toEqual(['hasMore', 'page', 'pageSize']);
    expect(documentedMetaKeys(document, path)).toEqual(sentKeys(response.body));
  });

  it('GET /users/{username}/comments sends {pageSize, nextBefore}', async () => {
    const { user } = await signedInWriter(api, 'meta_author');
    const { session } = await signedInWriter(api, 'meta_staff', {
      permissions: ['judge.view_all_user_comment'],
    });
    const response = await authed(
      api.http().get(`/api/internal/users/${user.username}/comments`),
      session,
    ).expect(200);
    const path = '/api/internal/users/{username}/comments';
    expect(sentKeys(response.body)).toEqual(['nextBefore', 'pageSize']);
    expect(documentedMetaKeys(document, path)).toEqual(sentKeys(response.body));
  });
});
