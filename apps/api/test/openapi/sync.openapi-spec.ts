import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { CONTEST_FORMAT_NAMES } from '@libs/database';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

describe('sync API schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) =>
    document.components?.schemas?.[name] as SchemaObject;
  const OWN_SITE = /\/api\/sync\/v1\b|^schema (Sync[A-Za-z]*(Dto|Response))\b/;

  it('has no untyped parameter, empty schema or bare object on the sync routes', () => {
    expect(looseSites(document).filter((site) => OWN_SITE.test(site))).toEqual(
      [],
    );
  });

  it('shares the ContestFormatName enum and keeps formatConfig free-form', () => {
    expect(schema('ContestFormatName').enum).toHaveLength(
      CONTEST_FORMAT_NAMES.length,
    );
    expect(
      inlineEnumSites(document, CONTEST_FORMAT_NAMES).filter((site) =>
        site.includes('Sync'),
      ),
    ).toEqual([]);
    expect(schema('SyncContestDto').properties?.['formatName']).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/ContestFormatName' }],
    });
    expect(schema('SyncContestDto').properties?.['formatConfig']).toMatchObject(
      { type: 'object', additionalProperties: true },
    );
  });

  it('documents the upsert query and both contest routes', () => {
    const route = '/api/sync/v1/contests/{key}';
    expect(
      parameterOf(document, { route, method: 'put' }, 'dryRun'),
    ).toMatchObject({ required: false });
    expect(
      Object.keys(operationOf(document, route, 'put').responses),
    ).toContain('200');
    expect(
      Object.keys(operationOf(document, route, 'get').responses),
    ).toContain('200');
    expect(
      [...((schema('SyncUpsertAction').enum ?? []) as string[])].sort(),
    ).toEqual(['created', 'unchanged', 'updated']);
  });

  it('documents participants, removal and standings', () => {
    const base = '/api/sync/v1/contests/{key}';
    const statuses = (route: string, method: 'get' | 'put' | 'delete') =>
      Object.keys(operationOf(document, route, method).responses);
    expect(statuses(`${base}/participants`, 'put')).toContain('200');
    expect(statuses(base, 'delete')).toContain('204');
    expect(statuses(`${base}/standings`, 'get')).toContain('200');
    expect(schema('SyncParticipantsResponse').properties).toMatchObject({
      applied: { type: 'number' },
      unknown: { type: 'array', items: { type: 'string' } },
    });
    expect(
      schema('SyncParticipantsDto').properties?.['usernames'],
    ).toMatchObject({ type: 'array', maxItems: 2000 });
  });
});
