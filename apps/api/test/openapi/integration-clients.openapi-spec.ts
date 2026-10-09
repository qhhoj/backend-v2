import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { INTEGRATION_SCOPES } from '@libs/database';
import { loadDocument, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

describe('integration client schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const OWN_SITE =
    /\/api\/internal\/integration-clients\b|^schema (CreateIntegrationClientDto|IntegrationClientResponse|CreatedIntegrationClientResponse|IntegrationClientActingUserResponse)\b/;

  it('has no untyped parameter, empty schema or bare object on the client routes', () => {
    expect(looseSites(document).filter((site) => OWN_SITE.test(site))).toEqual(
      [],
    );
  });

  it('types the list paging as optional numbers', () => {
    const route = {
      route: '/api/internal/integration-clients',
      method: 'get',
    } as const;
    for (const name of ['page', 'pageSize'])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'number', minimum: 1 },
      });
  });

  it('lists the scopes as one named enum on the request and the response', () => {
    const scopes = document.components?.schemas?.[
      'IntegrationScope'
    ] as SchemaObject;
    expect(scopes.enum).toHaveLength(INTEGRATION_SCOPES.length);
    expect(inlineEnumSites(document, INTEGRATION_SCOPES)).toEqual([]);
    for (const name of [
      'CreateIntegrationClientDto',
      'IntegrationClientResponse',
    ])
      expect(
        (document.components?.schemas?.[name] as SchemaObject).properties?.[
          'scopes'
        ],
      ).toMatchObject({
        type: 'array',
        items: { $ref: '#/components/schemas/IntegrationScope' },
      });
  });
});
