import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument } from './document';
import { looseSites } from './schema-scans';

describe('official mode in the OpenAPI document', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const site = () =>
    document.components?.schemas?.['SiteResponse'] as SchemaObject;

  it('documents SiteResponse.officialMode as a required boolean', () => {
    expect(site().properties).toMatchObject({
      officialMode: { type: 'boolean' },
    });
    expect(site().required).toContain('officialMode');
  });

  it('documents SiteResponse.officialModeEndsAt as a required, nullable date-time string', () => {
    expect(site().properties).toMatchObject({
      officialModeEndsAt: {
        type: 'string',
        format: 'date-time',
        nullable: true,
      },
    });
    expect(site().required).toContain('officialModeEndsAt');
  });

  it('leaves no loose site on the site schema or route', () => {
    expect(
      looseSites(document).filter((entry) =>
        /SiteResponse|\/api\/internal\/site\b/.test(entry),
      ),
    ).toEqual([]);
  });
});
