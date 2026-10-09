import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { CONTEST_TAG_COLORS } from '@libs/database';
import { loadDocument, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

const OWN_SITE = /\/api\/internal\/contest-tags\b|ContestTag/;
const COLOR_REF = { $ref: '#/components/schemas/ContestTagColor' };

describe('contest tag schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  const properties = (name: string) =>
    schema(name).properties as Record<string, SchemaObject>;
  /** A described property wraps its ref in `allOf`; both shapes name the same schema. */
  const refOf = (property: SchemaObject) =>
    (property as { $ref?: string; allOf?: Array<{ $ref?: string }> }).$ref ??
    (property as { allOf?: Array<{ $ref?: string }> }).allOf?.[0]?.$ref;
  const owned = (sites: string[]) =>
    sites.filter((site) => OWN_SITE.test(site));

  it('has no loose site on the tag routes and schemas', () => {
    expect(owned(looseSites(document))).toEqual([]);
  });

  it('types the paging as optional numbers within their bounds', () => {
    const route = {
      route: '/api/internal/contest-tags',
      method: 'get',
    } as const;
    for (const name of ['page', 'pageSize'])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'number', minimum: 1 },
      });
  });

  it('names ContestTagColor once, on the request and the response', () => {
    // One enumName reused for another set would merge them silently: the member count catches it.
    expect(schema('ContestTagColor').enum).toHaveLength(
      CONTEST_TAG_COLORS.length,
    );
    expect(refOf(properties('CreateContestTagDto').color)).toEqual(
      COLOR_REF.$ref,
    );
    expect(refOf(properties('ContestTagResponse').color)).toEqual(
      COLOR_REF.$ref,
    );
    expect(owned(inlineEnumSites(document, CONTEST_TAG_COLORS))).toEqual([]);
  });
});
