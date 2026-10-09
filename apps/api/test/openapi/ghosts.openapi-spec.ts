import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { GHOST_GAPS } from '@libs/contests';
import { loadDocument, operationOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

describe('ghost schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it('has no untyped parameter, empty schema or bare object on the ghost routes and schemas', () => {
    expect(
      looseSites(document).filter((site) => /\/ghosts|Ghost/.test(site)),
    ).toEqual([]);
  });

  it('lists exactly the members a ghost, a ghost cell and an import answer carry', () => {
    expect(Object.keys(schema('GhostResponse').properties!).sort()).toEqual([
      'caption',
      'cells',
      'gap',
      'isUnranked',
      'label',
    ]);
    expect(Object.keys(schema('GhostCellResponse').properties!).sort()).toEqual(
      ['minute', 'points', 'problemCode', 'rejectedBefore'],
    );
    expect(
      Object.keys(schema('GhostImportResponse').properties!).sort(),
    ).toEqual(['ghosts', 'stored']);
  });

  it('names the data gap once, with every member, and spells it inline nowhere', () => {
    expect(schema('GhostGap').enum).toHaveLength(GHOST_GAPS.length);
    expect(inlineEnumSites(document, GHOST_GAPS)).toEqual([]);
    expect(JSON.stringify(schema('GhostResponse').properties!.gap)).toContain(
      '#/components/schemas/GhostGap',
    );
  });

  it('documents the CSV download as a text/csv file and the import as a JSON body', () => {
    const download = operationOf(
      document,
      '/api/internal/contests/{key}/ghosts/csv',
      'get',
    );
    expect(download.responses['200']).toMatchObject({
      content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
    });
    expect(Object.keys(schema('ImportGhostsDto').properties!).sort()).toEqual([
      'anonymize',
      'csv',
      'dryRun',
    ]);
  });
});
