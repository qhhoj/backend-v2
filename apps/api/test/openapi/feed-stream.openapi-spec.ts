import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { feedLineOf } from '../../src/modules/contests/feed/feed.service';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';

const STREAM = '/api/internal/events/contests/{key}/feed';

describe('feed stream route', () => {
  let document: OpenAPIObject;
  let line: SchemaObject;
  beforeAll(async () => {
    document = await loadDocument();
    line = document.components!.schemas!.FeedLineResponse as SchemaObject;
  });

  it('documents the NDJSON lines it sends, not server-sent events, and has no loose site', () => {
    const response = operationOf(document, STREAM, 'get').responses['200'] as {
      content: Record<string, { schema: { $ref?: string } }>;
    };
    expect(response.content).toEqual({
      'application/x-ndjson': {
        schema: { $ref: '#/components/schemas/FeedLineResponse' },
      },
    });
    expect(
      looseSites(document).filter((site) => site.startsWith(`GET ${STREAM}`)),
    ).toEqual([]);
  });

  it('documents the event types of the feed and no resync', () => {
    const types = ((line.properties!.type as SchemaObject).enum ?? []).map(
      String,
    );
    expect(types).toEqual(
      expect.arrayContaining([
        'contest',
        'teams',
        'submissions',
        'judgements',
        'state',
      ]),
    );
    expect(types).not.toContain('resync');
  });

  it('documents exactly the members a feed line has', () => {
    const built = feedLineOf({
      type: 'state',
      id: null,
      data: { started: null },
      token: '1',
    });
    expect(Object.keys(line.properties!).sort()).toEqual(
      Object.keys(built).sort(),
    );
  });
});
