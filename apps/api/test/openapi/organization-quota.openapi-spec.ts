import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { RESERVED_ORGANIZATION_SLUG_PATTERN } from '../../src/modules/organizations/editing/dto/organization-edit.dto';
import { ORGANIZATION_TAG_COLORS } from '@libs/database';
import { loadDocument, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

/** Route prefixes and schema-name prefixes of the files this plan owns. */
const OWN_SITE =
  /organizations\/(\{slug\}\/(problem-tags|problems|quota|usage)|usage)\b|problems\/\{code\}\/archived-in|^schema (ProblemTag|OrganizationProblem|OrganizationUsage|Bulk|Usage|Quota|CreditEntry|ArchivedIn|UpdateQuota)/;

describe('organization problem tags, archive and quota schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string): SchemaObject => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it("has no untyped parameter, empty schema or bare object on this plan's own sites", () => {
    expect(looseSites(document).filter((site) => OWN_SITE.test(site))).toEqual(
      [],
    );
  });

  it('documents the organization slug pattern, not the reserved-word lookahead', () => {
    const slug = schema('CreateOrganizationDto').properties
      ?.slug as SchemaObject;
    expect(slug.pattern).toBeDefined();
    expect(slug.pattern).not.toBe(RESERVED_ORGANIZATION_SLUG_PATTERN.source);
  });

  it('types the tag list paging as optional numbers within their bounds', () => {
    const route = {
      route: '/api/internal/organizations/{slug}/problem-tags',
      method: 'get',
    } as const;
    for (const name of ['page', 'pageSize'])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'number', minimum: 1 },
      });
  });

  it('names the tag colour set once, with exactly the palette keys', () => {
    expect(schema('OrganizationTagColor').enum).toHaveLength(
      ORGANIZATION_TAG_COLORS.length,
    );
    expect(
      inlineEnumSites(document, ORGANIZATION_TAG_COLORS).filter(
        (site) => !site.startsWith('/components/schemas/'),
      ),
    ).toEqual([]);
  });
});
