import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { AUTO_PUBLISH_STATUSES } from '@libs/database';
import { PUBLISH_OUTCOMES, PUBLISH_SKIP_REASONS } from '@libs/problems';
import { loadDocument, operationOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';
import { EDITORIAL_OUTCOMES } from '../../src/modules/contests/publish/dto/publish-problems.response';

const OWN_SITE =
  /\/contests\/\{key\}\/(publish-problems|actions)\b|^schema (PublishProblemsDto|PublishProblemsResponse|PublishedProblemResponse|ContestActionsResponse|ContestAutoPublishResponse)\b/;
interface PropertySchema {
  $ref?: string;
  allOf?: Array<{ $ref?: string }>;
}
/** The schema a property points at, whether the $ref stands alone or sits in an allOf that carries a description. */
const refName = (property: SchemaObject): string | undefined => {
  const { $ref, allOf } = property as PropertySchema;
  return ($ref ?? allOf?.[0]?.$ref)?.split('/').pop();
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

describe('contest publish schemas', () => {
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
  const owned = (sites: string[]) =>
    sites.filter((site) => OWN_SITE.test(site));

  it('has no loose site on the publish route, the actions route and their schemas', () => {
    expect(owned(looseSites(document))).toEqual([]);
  });

  it('documents the publish request and its row', () => {
    expect(
      operationOf(
        document,
        '/api/internal/contests/{key}/publish-problems',
        'post',
      ).requestBody,
    ).toMatchObject({
      content: { 'application/json': { schema: ref('PublishProblemsDto') } },
    });
    expect(properties('PublishProblemsDto')).toMatchObject({
      editorials: { type: 'boolean' },
      dryRun: { type: 'boolean' },
    });
    expect(properties('PublishProblemsResponse')).toMatchObject({
      dryRun: { type: 'boolean' },
      items: { type: 'array', items: ref('PublishedProblemResponse') },
    });
  });

  it('names every publish enumeration once, with its constant as members', () => {
    // One enumName reused for another set would merge them silently: the member counts catch it.
    expect(schema('PublishOutcome').enum).toHaveLength(PUBLISH_OUTCOMES.length);
    expect(schema('PublishSkipReason').enum).toHaveLength(
      PUBLISH_SKIP_REASONS.length,
    );
    expect(schema('EditorialOutcome').enum).toHaveLength(
      EDITORIAL_OUTCOMES.length,
    );
    expect(schema('ContestAutoPublishStatus').enum).toHaveLength(
      AUTO_PUBLISH_STATUSES.length,
    );
    const row = properties('PublishedProblemResponse');
    expect(refName(row.outcome)).toBe('PublishOutcome');
    expect(row.reason).toMatchObject({ nullable: true });
    expect(row.editorial).toMatchObject({ nullable: true });
    expect(refName(properties('ContestActionsResponse').publish)).toBe(
      'ContestActionState',
    );
    expect(refName(properties('ContestAutoPublishResponse').status)).toBe(
      'ContestAutoPublishStatus',
    );
    for (const values of [
      PUBLISH_OUTCOMES,
      PUBLISH_SKIP_REASONS,
      EDITORIAL_OUTCOMES,
      AUTO_PUBLISH_STATUSES,
    ])
      expect(owned(inlineEnumSites(document, values))).toEqual([]);
  });
});
