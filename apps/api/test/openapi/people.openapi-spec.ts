import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { ORGANIZATION_REQUEST_STATES } from '@libs/database';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

const PAGED = [
  '/api/internal/organizations',
  '/api/internal/organizations/{slug}/members',
  '/api/internal/users',
  '/api/internal/contributors',
  '/api/internal/users/{username}/pp-breakdown',
  '/api/internal/admin/users',
];
const PAGE_ONLY = [
  '/api/internal/organizations/{slug}/requests',
  '/api/internal/admin/organization-requests',
];
/** The routes and schemas this lane owns. `PostPageQueryDto` (org posts, user blog) belongs to the blog lane. */
const OWN_ROUTE =
  /\/api\/internal\/(auth|users|contributors|organizations|profile|admin\/users|admin\/organization-requests)\b/;
const OWN_SITE =
  /\/api\/internal\/(auth|users|contributors|organizations|profile|admin\/users|admin\/organization-requests)\b|\/components\/schemas\/(OrganizationRequest|CreateOrganizationRequest|DecideOrganizationRequest)/;
const BLOG_SITE = /\/(blog|posts)\b/;

describe('auth, user and organization schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it('has no untyped parameter or bare object on these routes', () => {
    const owned = looseSites(document).filter(
      (site) => OWN_ROUTE.test(site) && !BLOG_SITE.test(site),
    );
    expect(owned).toEqual([]);
  });

  it('types the paging of every list as optional numbers', () => {
    for (const route of [...PAGED, ...PAGE_ONLY])
      expect(
        parameterOf(document, { route, method: 'get' }, 'page'),
      ).toMatchObject({
        required: false,
        schema: { type: 'number' },
      });
    for (const route of PAGED)
      expect(
        parameterOf(document, { route, method: 'get' }, 'pageSize'),
      ).toMatchObject({
        required: false,
        schema: { type: 'number' },
      });
  });

  it('shares one OrganizationRequestState enum', () => {
    expect(schema('OrganizationRequestState').enum).toHaveLength(
      ORGANIZATION_REQUEST_STATES.length,
    );
    expect(
      inlineEnumSites(document, ORGANIZATION_REQUEST_STATES).filter((site) =>
        OWN_SITE.test(site),
      ),
    ).toEqual([]);
  });

  it('documents the WebAuthn options as free-form objects, the login one nullable', () => {
    const dataOf = (route: string) =>
      (
        operationOf(document, route, 'post').responses['201'] as unknown as {
          content: {
            'application/json': {
              schema: { properties: { data: SchemaObject } };
            };
          };
        }
      ).content['application/json'].schema.properties.data;
    expect(
      dataOf('/api/internal/auth/2fa/webauthn/register/options'),
    ).toMatchObject({
      type: 'object',
      additionalProperties: true,
    });
    expect(
      dataOf('/api/internal/auth/2fa/webauthn/login/options'),
    ).toMatchObject({
      type: 'object',
      additionalProperties: true,
      nullable: true,
    });
  });

  it('documents the profile data download as a zip file', () => {
    expect(
      operationOf(document, '/api/internal/profile/data/download', 'get')
        .responses['200'],
    ).toMatchObject({
      content: {
        'application/zip': { schema: { type: 'string', format: 'binary' } },
      },
    });
  });
});
