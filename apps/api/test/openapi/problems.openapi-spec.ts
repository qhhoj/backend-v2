import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { STATEMENT_LANGUAGES } from '@libs/database';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

/** Schemas whose classes live in the problems and tags modules (UserSummaryResponse is shared and owned by M0). */
const OWN_SCHEMAS = [
  'AssignTagsDto',
  'CatalogItemResponse',
  'CloneProblemDto',
  'CreateLanguageDto',
  'CreateProblemDto',
  'CreateTagProblemDto',
  'EditorialResponse',
  'ImportJobResponse',
  'ImportJobStartedResponse',
  'ImportResultResponse',
  'LanguageAdminResponse',
  'LanguageLimitDto',
  'LanguageLimitResponse',
  'LanguageResponse',
  'LicenseResponse',
  'PdfRenderingResponse',
  'ProblemContestResponse',
  'ProblemDataLimitsResponse',
  'ProblemDataResponse',
  'ProblemDetailResponse',
  'ProblemEditorResponse',
  'ProblemEditorialDraftResponse',
  'ProblemListItemResponse',
  'ProblemMetaResponse',
  'ProblemRefResponse',
  'ProblemTranslationResponse',
  'PutEditorialDto',
  'PutProblemDataDto',
  'PutTranslationDto',
  'RenderPreviewDto',
  'TagAssignmentResponse',
  'TagCatalogResponse',
  'TagGroupResponse',
  'TagProblemListItemResponse',
  'TagProblemResponse',
  'TagResponse',
  'TestCaseDto',
  'TestCaseResponse',
  'UpdateLanguageDto',
  'UpdateProblemDto',
  'UploadedFileResponse',
];
const OWN_ROUTE = /\/api\/internal\/(problems|tags)\b/;
const OWN_SCHEMA_NAMES = OWN_SCHEMAS.join('|');
/** Loose sites are labelled `schema <Name>...`; inline enums sit under `/components/schemas/<Name>/`. */
const OWN_SCHEMA = new RegExp(
  `^schema (${OWN_SCHEMA_NAMES})\\b|\\/components\\/schemas\\/(${OWN_SCHEMA_NAMES})\\/`,
);

describe('problem and tag schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };
  /** Sites on the problem and tag routes (not B7's ticket routes) and on the schemas this lane owns. */
  const ownSites = (sites: string[]) =>
    sites.filter(
      (site) =>
        (OWN_ROUTE.test(site) && !site.includes('/tickets')) ||
        OWN_SCHEMA.test(site),
    );

  it('documents every schema this lane owns', () => {
    const missing = OWN_SCHEMAS.filter(
      (name) => !document.components?.schemas?.[name],
    );
    expect(missing).toEqual([]);
  });

  it('has no untyped parameter, empty schema or bare object on problem and tag routes and schemas', () => {
    expect(ownSites(looseSites(document))).toEqual([]);
  });

  it('types the list paging as optional numbers within their bounds', () => {
    const route = { route: '/api/internal/problems', method: 'get' } as const;
    for (const name of ['page', 'pageSize'])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'number', minimum: 1 },
      });
  });

  it('lists the sort values and shares one StatementLanguage enum', () => {
    const route = { route: '/api/internal/problems', method: 'get' } as const;
    expect(parameterOf(document, route, 'sort').schema).toEqual({
      $ref: '#/components/schemas/ProblemSort',
    });
    expect(schema('ProblemSort').enum).toContain('-date');
    // One enumName reused for another set would merge them silently: the member count catches it.
    expect(schema('StatementLanguage').enum).toHaveLength(
      STATEMENT_LANGUAGES.length,
    );
    expect(ownSites(inlineEnumSites(document, STATEMENT_LANGUAGES))).toEqual(
      [],
    );
  });

  it('types the import flags as optional booleans', () => {
    const route = {
      route: '/api/internal/problems/imports',
      method: 'post',
    } as const;
    for (const name of [
      'ignoreZeroPointBatches',
      'ignoreZeroPointCases',
      'appendMainSolution',
    ])
      expect(parameterOf(document, route, name)).toMatchObject({
        required: false,
        schema: { type: 'boolean' },
      });
  });

  it('documents every testcase and data setting with its type', () => {
    expect(schema('TestCaseDto').properties).toMatchObject({
      input: { type: 'string' },
      output: { type: 'string' },
      isPretest: { type: 'boolean' },
      generatorArgs: { type: 'string' },
    });
    expect(schema('PutProblemDataDto').properties).toMatchObject({
      unicode: { type: 'boolean' },
      nobigmath: { type: 'boolean' },
    });
  });

  it('documents the data file download as a binary attachment', () => {
    const operation = operationOf(
      document,
      '/api/internal/problems/{code}/data/files/{name}',
      'get',
    );
    expect(operation.responses['200']).toMatchObject({
      content: {
        'application/octet-stream': {
          schema: { type: 'string', format: 'binary' },
        },
      },
    });
  });
});
