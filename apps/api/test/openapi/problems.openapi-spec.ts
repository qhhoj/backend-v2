import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import {
  STATEMENT_LANGUAGES,
  SUBMISSION_SOURCE_VISIBILITIES,
  TESTCASE_RESULT_VISIBILITIES,
  TESTCASE_VISIBILITIES,
} from '@libs/database';
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
  /** Sites on the problem and tag routes (ticket routes are checked in their own spec). */
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

  it('documents the six upload routes as multipart with a binary file field', () => {
    const uploads = [
      '/api/internal/problems/uploads/image',
      '/api/internal/problems/{code}/statement',
      '/api/internal/problems/{code}/material',
      '/api/internal/problems/{code}/data/archive',
      '/api/internal/problems/{code}/data/files/{kind}',
      '/api/internal/problems/imports',
    ];
    for (const route of uploads) {
      const body = operationOf(document, route, 'post').requestBody as {
        content: Record<string, { schema: SchemaObject }>;
      };
      expect(Object.keys(body.content)).toEqual(['multipart/form-data']);
      const { schema: form } = body.content['multipart/form-data'];
      expect(form.required).toContain('file');
      expect(form.properties?.file).toEqual({
        type: 'string',
        format: 'binary',
      });
    }
  });

  it('shares one named enum per visibility code across detail, create and update', () => {
    const named = {
      submissionSourceVisibility: [
        'SubmissionSourceVisibility',
        SUBMISSION_SOURCE_VISIBILITIES,
      ],
      testcaseVisibility: ['TestcaseVisibility', TESTCASE_VISIBILITIES],
      testcaseResultVisibility: [
        'TestcaseResultVisibility',
        TESTCASE_RESULT_VISIBILITIES,
      ],
    } as const;
    for (const [member, [name, codes]] of Object.entries(named)) {
      expect((schema(name).enum ?? []).map(String).sort()).toEqual(
        [...codes].sort(),
      );
      for (const owner of [
        'ProblemDetailResponse',
        'CreateProblemDto',
        'UpdateProblemDto',
      ]) {
        const site = schema(owner).properties?.[member] as {
          $ref?: string;
          allOf?: Array<{ $ref?: string }>;
        };
        expect(site.$ref ?? site.allOf?.[0]?.$ref).toBe(
          `#/components/schemas/${name}`,
        );
      }
    }
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
      'importTutorial',
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
