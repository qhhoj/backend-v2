import type { OpenAPIObject } from '@nestjs/swagger';
import { feedLineOf } from '../../src/modules/contests/feed/feed.service';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';
import { frameDataKeys, streamEventNames } from './stream-frames';

const STREAM = '/api/internal/events/contests/{key}/feed';

describe('feed stream route', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has an event-stream body and no loose site', () => {
    const response = operationOf(document, STREAM, 'get').responses['200'];
    expect(response).toHaveProperty('content.text/event-stream');
    expect(
      looseSites(document).filter((site) => site.startsWith(`GET ${STREAM}`)),
    ).toEqual([]);
  });

  it('documents the event types of the feed and sends no resync', () => {
    const names = streamEventNames(document, STREAM);
    expect(names).toEqual(
      expect.arrayContaining([
        'contest',
        'teams',
        'submissions',
        'judgements',
        'state',
      ]),
    );
    expect(names).not.toContain('resync');
  });

  it('documents exactly the members a feed line has', () => {
    const line = feedLineOf({
      type: 'state',
      id: null,
      data: { started: null },
      token: '1',
    });
    expect(frameDataKeys(document, 'FeedEventFrame')).toEqual(
      Object.keys(line).sort(),
    );
  });
});
