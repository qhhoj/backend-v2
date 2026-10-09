import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { RESERVED_ORGANIZATION_SLUG_PATTERN } from '../../src/modules/organizations/editing/dto/organization-edit.dto';
import { loadDocument } from './document';
import { looseSites } from './schema-scans';

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
});
