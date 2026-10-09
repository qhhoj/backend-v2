import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, operationOf, parameterOf } from './document';
import { looseSites } from './schema-scans';
import { SHORT_LINK_SCOPES } from '../../src/modules/short-links/dto/short-link.dto';

describe('short link schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const OWN_SITE =
    /\/api\/internal\/short-links\b|\/s\/\{code\}|^schema (CreateShortLinkDto|ShortLinkResponse)\b/;

  it('has no untyped parameter, empty schema or bare object on the short link routes', () => {
    expect(looseSites(document).filter((site) => OWN_SITE.test(site))).toEqual(
      [],
    );
  });

  it('types the list paging as optional numbers and names the scope enum', () => {
    const route = {
      route: '/api/internal/short-links',
      method: 'get',
    } as const;
    for (const name of ['page', 'pageSize'])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'number', minimum: 1 },
      });
    expect(parameterOf(document, route, 'scope').schema).toEqual({
      $ref: '#/components/schemas/ShortLinkScope',
    });
    const scope = document.components?.schemas?.[
      'ShortLinkScope'
    ] as SchemaObject;
    expect(scope.enum).toHaveLength(SHORT_LINK_SCOPES.length);
  });

  it('documents the redirect as a 302 and the delete as a 204', () => {
    expect(
      Object.keys(operationOf(document, '/s/{code}', 'get').responses),
    ).toContain('302');
    expect(
      Object.keys(
        operationOf(document, '/api/internal/short-links/{code}', 'delete')
          .responses,
      ),
    ).toContain('204');
  });
});
