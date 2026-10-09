import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { STATEMENT_LANGUAGES } from '@libs/database';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

describe('problem and tag schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  const OWN_SITE =
    /\/api\/internal\/(problems|tags)\b|\/schemas\/(Problem|Editorial|Translation|Tag|TestCase)/;
  const ownSites = (sites: string[]) =>
    sites.filter((site) => OWN_SITE.test(site));

  it('has no untyped parameter, empty schema or bare object on problem and tag routes', () => {
    const ownLoose = looseSites(document).filter(
      (site) =>
        /\/api\/internal\/(problems|tags)\b/.test(site) &&
        !site.includes('/tickets') &&
        !site.includes('/pdf'),
    );
    const schemas = looseSites(document).filter((site) =>
      /^schema (TestCaseDto|PutProblemDataDto)\b/.test(site),
    );
    expect([...ownLoose, ...schemas]).toEqual([]);
  });

  it('types the list paging as optional numbers within their bounds', () => {
    const route = { route: '/api/internal/problems', method: 'get' } as const;
    for (const name of ['page', 'pageSize'])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'number', minimum: 1 },
      });
  });

  it('lists the sort values and shares one StatementLanguage enum', () => {
    const route = { route: '/api/internal/problems', method: 'get' } as const;
    expect(parameterOf(document, route, 'sort').schema).toEqual({
      $ref: '#/components/schemas/ProblemSort',
    });
    expect(schema('ProblemSort').enum).toContain('-date');
    // One enumName reused for another set would merge them silently: the member count catches it.
    expect(schema('StatementLanguage').enum).toHaveLength(
      STATEMENT_LANGUAGES.length,
    );
    expect(ownSites(inlineEnumSites(document, STATEMENT_LANGUAGES))).toEqual(
      [],
    );
  });

  it('types the import flags as optional booleans', () => {
    const route = {
      route: '/api/internal/problems/imports',
      method: 'post',
    } as const;
    for (const name of [
      'ignoreZeroPointBatches',
      'ignoreZeroPointCases',
      'appendMainSolution',
    ])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'boolean' },
      });
  });

  it('documents every testcase and data setting with its type', () => {
    expect(schema('TestCaseDto').properties).toMatchObject({
      input: { type: 'string' },
      output: { type: 'string' },
      isPretest: { type: 'boolean' },
      generatorArgs: { type: 'string' },
    });
    expect(schema('PutProblemDataDto').properties).toMatchObject({
      unicode: { type: 'boolean' },
      nobigmath: { type: 'boolean' },
    });
  });

  it('documents the data file download as a binary attachment', () => {
    const operation = operationOf(
      document,
      '/api/internal/problems/{code}/data/files/{name}',
      'get',
    );
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/octet-stream': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    });
  });
});
