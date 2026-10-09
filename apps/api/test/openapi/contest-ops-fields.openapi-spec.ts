import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument } from './document';
import { looseSites } from './schema-scans';

describe('contest balloon fields in the document', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const member = (schema: string, property: string) => {
    const found = (
      document.components?.schemas?.[schema] as SchemaObject | undefined
    )?.properties?.[property];
    if (!found) throw new Error(`${schema}.${property} is not documented`);
    return found as SchemaObject;
  };

  it('has no loose site on the contest schemas this plan extends', () => {
    const own = looseSites(document).filter((site) =>
      /^schema (UpdateContestDto|ContestSettingsResponse|ContestViewerResponse)\b/.test(
        site,
      ),
    );
    expect(own).toEqual([]);
  });

  it('types the flags as booleans and the volunteer list as an array of ids', () => {
    expect(member('UpdateContestDto', 'balloons')).toMatchObject({
      type: 'boolean',
    });
    expect(member('UpdateContestDto', 'balloonStaff')).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    expect(member('ContestSettingsResponse', 'balloons')).toMatchObject({
      type: 'boolean',
    });
    expect(member('ContestSettingsResponse', 'balloonStaff')).toMatchObject({
      type: 'array',
      items: { type: 'string' },
    });
    expect(member('ContestViewerResponse', 'canViewBalloons')).toMatchObject({
      type: 'boolean',
    });
  });
});
