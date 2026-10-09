import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';

describe('contest export routes', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has no loose site on the export routes and status response', () => {
    const own = looseSites(document).filter(
      (site) =>
        site.includes('/export') ||
        /^schema ContestExportStatusResponse\b/.test(site),
    );
    expect(own).toEqual([]);
  });

  it('describes the download as a binary zip, not a ReadStream object', () => {
    const response = operationOf(
      document,
      '/api/internal/contests/{key}/export/download',
      'get',
    ).responses['200'] as {
      content?: Record<string, { schema?: SchemaObject }>;
    };
    expect(response.content?.['application/zip']?.schema).toEqual({
      type: 'string',
      format: 'binary',
    });
  });

  it('lists the three export states on the status response', () => {
    const state = (
      document.components?.schemas?.ContestExportStatusResponse as SchemaObject
    ).properties?.state as SchemaObject;
    expect(state.enum).toEqual(
      expect.arrayContaining(['none', 'preparing', 'ready']),
    );
  });
});
