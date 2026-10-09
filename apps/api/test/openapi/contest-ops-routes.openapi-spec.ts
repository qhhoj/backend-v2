import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { CONTEST_ACTION_STATES } from '../../src/modules/contests/editing/dto/contest-actions.response';
import { loadDocument } from './document';
import { inlineEnumSites } from './schema-scans';

describe('balloon, feed-key, feed and export routes', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const properties = (name: string): string[] =>
    Object.keys(
      (document.components?.schemas?.[name] as SchemaObject).properties ?? {},
    );

  it('documents every route of the plan', () => {
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/contests/{key}/balloons',
        '/api/internal/contests/{key}/balloons/{participation}/{problem}/deliver',
        '/api/internal/contests/{key}/balloons/{participation}/{problem}/undeliver',
        '/api/internal/contests/{key}/feed-key',
        '/api/internal/contests/{key}/feed-key/release',
        '/api/internal/contests/{key}/feed',
        '/api/internal/events/contests/{key}/feed',
        '/api/internal/contests/{key}/export',
        '/api/internal/contests/{key}/export/download',
      ]),
    );
  });

  it('documents the fields the screens read', () => {
    expect(properties('BalloonResponse')).toEqual(
      expect.arrayContaining([
        'team',
        'solvedAt',
        'isFirst',
        'deliveredAt',
        'deliveredBy',
      ]),
    );
    expect(properties('MintedFeedKeyResponse').sort()).toEqual([
      'expiresAt',
      'key',
      'mode',
      'username',
    ]);
    expect(properties('ContestExportStatusResponse')).toEqual(
      expect.arrayContaining(['state', 'nextPrepareAt']),
    );
    expect(properties('ContestViewerResponse')).toContain('canViewBalloons');
    expect(properties('ContestSettingsResponse')).toEqual(
      expect.arrayContaining(['balloons', 'balloonStaff']),
    );
  });

  it('reuses the ContestActionState component for the export state', () => {
    const exportState = (
      document.components?.schemas?.ContestActionsResponse as SchemaObject
    ).properties?.export;
    expect(JSON.stringify(exportState)).toContain(
      '#/components/schemas/ContestActionState',
    );
    expect(inlineEnumSites(document, CONTEST_ACTION_STATES)).toEqual([]);
  });

  it('marks the feed snapshot raw (no data envelope)', () => {
    const operation = document.paths['/api/internal/contests/{key}/feed']
      ?.get as unknown as Record<string, unknown>;
    expect(operation['x-raw']).toBe(true);
  });
});
