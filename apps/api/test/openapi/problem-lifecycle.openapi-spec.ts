import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, operationOf, parameterOf } from './document';
import { looseSites } from './schema-scans';

const ROUTE = '/api/internal/problems';

describe('problem lifecycle schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it('has no loose site on the lifecycle routes and DTOs', () => {
    expect(
      looseSites(document).filter((site) =>
        /(\/deleted|\/restore|\/purge-now|DeletedListQueryDto|DeletedProblemResponse|ConfirmCodeDto|PurgeQueuedResponse)\b/.test(
          site,
        ),
      ),
    ).toEqual([]);
  });

  it('types the deleted-list paging as optional numbers with defaults', () => {
    const target = { route: `${ROUTE}/deleted`, method: 'get' } as const;
    const page = parameterOf(document, target, 'page');
    const pageSize = parameterOf(document, target, 'pageSize');
    expect(page.required).toBeFalsy();
    expect(page.schema).toMatchObject({
      type: 'number',
      minimum: 1,
      maximum: 10000,
      default: 1,
    });
    expect(pageSize.required).toBeFalsy();
    expect(pageSize.schema).toMatchObject({
      type: 'number',
      minimum: 1,
      maximum: 100,
      default: 50,
    });
  });

  it('lists exactly the members of a deleted problem row', () => {
    expect(
      Object.keys(schema('DeletedProblemResponse').properties ?? {}).sort(),
    ).toEqual([
      'code',
      'daysLeft',
      'deletedAt',
      'deletedBy',
      'isPurged',
      'name',
    ]);
  });

  it('answers 204 to delete and restore and 202 to purge-now', () => {
    expect(
      operationOf(document, `${ROUTE}/{code}`, 'delete').responses,
    ).toHaveProperty('204');
    expect(
      operationOf(document, `${ROUTE}/{code}/restore`, 'post').responses,
    ).toHaveProperty('204');
    expect(
      operationOf(document, `${ROUTE}/{code}/purge-now`, 'post').responses,
    ).toHaveProperty('202');
  });
});
