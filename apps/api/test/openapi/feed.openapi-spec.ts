import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';

const SNAPSHOT = '/api/internal/contests/{key}/feed';

describe('feed snapshot route', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has no loose site on the snapshot route', () => {
    const own = looseSites(document).filter((site) =>
      site.startsWith(`GET ${SNAPSHOT}`),
    );
    expect(own).toEqual([]);
  });

  it('describes the snapshot as a raw NDJSON body', () => {
    const operation = operationOf(document, SNAPSHOT, 'get');
    const response = operation.responses['200'] as {
      content?: Record<string, { schema?: SchemaObject }>;
    };
    expect(response.content?.['application/x-ndjson']?.schema).toEqual({
      type: 'string',
      format: 'binary',
    });
    expect((operation as unknown as Record<string, unknown>)['x-raw']).toBe(
      true,
    );
  });
});
