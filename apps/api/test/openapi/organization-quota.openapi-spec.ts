import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { USAGE_SORTS } from '../../src/modules/organizations/usage/dto/usage.dto';
import { BULK_ACTIONS } from '../../src/modules/organizations/problems/dto/bulk.dto';
import { ARCHIVE_FILTERS } from '../../src/modules/organizations/problems/dto/organization-problem.dto';
import { RESERVED_ORGANIZATION_SLUG_PATTERN } from '../../src/modules/organizations/editing/dto/organization-edit.dto';
import { ORGANIZATION_TAG_COLORS } from '@libs/database';
import { loadDocument, operationOf, parameterOf } from './document';
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

  it('shares the contest tag colour component, which has exactly the palette keys', () => {
    expect(schema('ContestTagColor').enum).toHaveLength(
      ORGANIZATION_TAG_COLORS.length,
    );
    expect(
      inlineEnumSites(document, ORGANIZATION_TAG_COLORS).filter(
        (site) => !site.startsWith('/components/schemas/'),
      ),
    ).toEqual([]);
  });

  it('documents the organization problem list query by its wire names', () => {
    const route = {
      route: '/api/internal/organizations/{slug}/problems',
      method: 'get',
    } as const;
    expect(parameterOf(document, route, 'q')).toMatchObject({
      required: false,
      schema: { type: 'string' },
    });
    expect(() => parameterOf(document, route, 'search')).toThrow(
      /no parameter search/,
    );
    expect(parameterOf(document, route, 'page')).toMatchObject({
      required: false,
      schema: { type: 'number' },
    });
    expect(parameterOf(document, route, 'archived').schema).toMatchObject({
      $ref: '#/components/schemas/OrganizationProblemArchiveFilter',
    });
    expect(schema('OrganizationProblemArchiveFilter').enum).toHaveLength(
      ARCHIVE_FILTERS.length,
    );
  });

  it('documents OrganizationProblemResponse.updatedAt as a required date-time', () => {
    const response = schema('OrganizationProblemResponse');
    expect(response.properties).toMatchObject({
      updatedAt: { type: 'string', format: 'date-time' },
    });
    expect(response.required).toContain('updatedAt');
  });

  it('documents the bulk body action as a named enum and the archived-in route', () => {
    const properties = schema('BulkProblemsDto').properties as Record<
      string,
      SchemaObject
    >;
    expect(JSON.stringify(properties.action)).toContain(
      '#/components/schemas/OrganizationProblemBulkAction',
    );
    expect(schema('OrganizationProblemBulkAction').enum).toHaveLength(
      BULK_ACTIONS.length,
    );
    expect(
      Object.keys(schema('BulkResultResponse').properties ?? {}).sort(),
    ).toEqual(['code', 'outcome', 'reason']);
    expect(
      operationOf(document, '/api/internal/problems/{code}/archived-in', 'get')
        .responses['200'],
    ).toBeDefined();
  });

  it('documents the usage overview query, the nullable quota fields and the named response parts', () => {
    const route = {
      route: '/api/internal/organizations/usage',
      method: 'get',
    } as const;
    expect(parameterOf(document, route, 'page')).toMatchObject({
      required: false,
      schema: { type: 'number' },
    });
    expect(
      JSON.stringify(parameterOf(document, route, 'sort').schema),
    ).toContain('#/components/schemas/OrganizationUsageSort');
    expect(schema('OrganizationUsageSort').enum).toHaveLength(
      USAGE_SORTS.length,
    );
    expect(schema('UpdateQuotaDto').properties).toMatchObject({
      quotaMonthlyCredits: { type: 'number', nullable: true },
      quotaStorageBytes: { type: 'number', nullable: true },
    });
    expect(schema('UsageQuotaResponse').properties).toMatchObject({
      monthlyCredits: { type: 'number', nullable: true },
      storageBytes: { type: 'number', nullable: true },
    });
    expect(
      Object.keys(schema('UsageOrganizationResponse').properties ?? {}).sort(),
    ).toEqual(['name', 'slug']);
  });

  it('documents the credit entry actor as a nullable named object', () => {
    const entry = schema('CreditEntryResponse');
    expect(JSON.stringify(entry.properties?.actor)).toContain(
      '#/components/schemas/CreditActorResponse',
    );
    expect(entry.properties?.actor).toMatchObject({ nullable: true });
    expect(
      Object.keys(schema('CreditActorResponse').properties ?? {}).sort(),
    ).toEqual(['id', 'username']);
  });
});
