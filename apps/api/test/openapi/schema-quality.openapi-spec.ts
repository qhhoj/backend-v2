import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataStorage } from 'class-validator';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  SchemaObject,
} from '@nestjs/swagger';
import {
  CONTEST_FORMAT_NAMES,
  LABEL_STYLES,
  STATEMENT_LANGUAGES,
  SUBMISSION_RESULTS,
  SUBMISSION_STATUSES,
} from '@libs/database';
import { loadDocument } from './document';
import {
  defaultedRequiredSites,
  duplicateEnums,
  unsortedEnumSites,
  inlineEnumSites,
  looseSites,
  namedEnumsWith,
} from './schema-scans';

type Metadatas = Map<{ name: string }, Array<{ propertyName: string }>>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const STREAM_TYPES = ['text/event-stream', 'application/x-ndjson'];

type Pools = { parameters: Set<string>; properties: Set<string> };

/** Names the document spells: operation parameters (query/path DTOs are inlined as these) and every schema property (mapped-type DTOs are inlined into the schema they build). */
function documentedNames(document: OpenAPIObject): Pools {
  const parameters = new Set<string>();
  for (const item of Object.values(document.paths))
    for (const method of METHODS)
      for (const parameter of (item[method]?.parameters ??
        []) as ParameterObject[])
        parameters.add(parameter.name);
  const properties = new Set<string>();
  for (const schema of Object.values(document.components?.schemas ?? {}))
    for (const name of Object.keys((schema as SchemaObject).properties ?? {}))
      properties.add(name);
  return { parameters, properties };
}

/**
 * A DTO with its own component must list the property. One without (a query or param DTO, or a mapped-type
 * intermediate such as `PartialCreateProblemDto`) is checked by name: a parameter for `*QueryDto` / `*ParamDto` / `*ParamsDto` / `*ListDto`,
 * a schema property for the rest. A class that is neither fails here instead of being skipped.
 */
function isDocumented(
  document: OpenAPIObject,
  pools: Pools,
  className: string,
  propertyName: string,
): boolean {
  const schema = document.components?.schemas?.[className] as
    SchemaObject | undefined;
  if (schema) return propertyName in (schema.properties ?? {});
  const inlinedAsParameters = /(Query|Params?|List)Dto$/.test(className);
  return (inlinedAsParameters ? pools.parameters : pools.properties).has(
    propertyName,
  );
}

type Flagged = Record<string, unknown>;
const operations = (document: OpenAPIObject) =>
  Object.entries(document.paths).flatMap(([route, item]) =>
    METHODS.flatMap((method) =>
      item[method]
        ? [
            {
              label: `${method.toUpperCase()} ${route}`,
              operation: item[method],
            },
          ]
        : [],
    ),
  );
const contentOf = (operation: OperationObject): Record<string, unknown> =>
  (operation.responses['200'] as { content?: Record<string, unknown> })
    ?.content ?? {};

/** Each scan below covers route sites (`GET /x ...`) and schema sites (`schema Name...`, `/components/schemas/Name/...`): never filter them by a route prefix. */
describe('OpenAPI schema quality', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has no untyped parameter, empty schema or bare object (free-form ones say additionalProperties)', () => {
    expect(looseSites(document)).toEqual([]);
  });

  it('marks no defaulted parameter or property as required (the client would force a value the server fills in)', () => {
    expect(defaultedRequiredSites(document)).toEqual([]);
  });

  it('documents every validated DTO property (the plugin drops what it cannot type)', () => {
    const validated = (
      getMetadataStorage() as unknown as { validationMetadatas: Metadatas }
    ).validationMetadatas;
    const pools = documentedNames(document);
    const missing: string[] = [];
    for (const [target, metadatas] of validated)
      for (const { propertyName } of metadatas)
        if (!isDocumented(document, pools, target.name, propertyName))
          missing.push(`${target.name}.${propertyName}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('wraps every JSON success body in data, bar raw and spelled-out envelopes', () => {
    const unwrapped = Object.entries(document.paths).flatMap(([route, item]) =>
      METHODS.flatMap((method) => {
        const operation = item[method];
        if (!operation) return [];
        const flags = operation as unknown as Record<string, unknown>;
        if (flags['x-raw'] || flags['x-enveloped']) return [];
        return Object.entries(operation.responses)
          .filter(([status]) => status.startsWith('2'))
          .filter(([, response]) => {
            const body = (
              response as {
                content?: Record<string, { schema?: { required?: string[] } }>;
              }
            ).content?.['application/json']?.schema;
            return body !== undefined && !body.required?.includes('data');
          })
          .map(([status]) => `${method.toUpperCase()} ${route} ${status}`);
      }),
    );
    expect(unwrapped).toEqual([]);
  });

  it('documents the error envelope on every operation', () => {
    const without = Object.entries(document.paths).flatMap(([route, item]) =>
      METHODS.flatMap((method) => {
        const operation = item[method];
        return operation && !operation.responses.default
          ? [`${method.toUpperCase()} ${route}`]
          : [];
      }),
    );
    expect(without).toEqual([]);
  });

  it('spells no shared enumeration inline, anywhere in the document', () => {
    for (const values of [
      STATEMENT_LANGUAGES,
      SUBMISSION_STATUSES,
      SUBMISSION_RESULTS,
      CONTEST_FORMAT_NAMES,
      LABEL_STYLES,
    ])
      expect(inlineEnumSites(document, values)).toEqual([]);
  });

  it('shares one component per enumeration, so every site has the same $ref (a renamed enumName fails)', () => {
    expect(duplicateEnums(document)).toEqual([]);
    expect(namedEnumsWith(document, STATEMENT_LANGUAGES)).toEqual([
      'StatementLanguage',
    ]);
    expect(namedEnumsWith(document, SUBMISSION_STATUSES)).toEqual([
      'SubmissionStatus',
    ]);
    expect(namedEnumsWith(document, SUBMISSION_RESULTS)).toEqual([
      'SubmissionResult',
    ]);
    expect(namedEnumsWith(document, CONTEST_FORMAT_NAMES)).toEqual([
      'ContestFormatName',
    ]);
    expect(namedEnumsWith(document, LABEL_STYLES)).toEqual([
      'ContestLabelStyle',
    ]);
  });

  it('lists every enum of the committed openapi.json in canonical order, so emit order never depends on load order', () => {
    const committed: unknown = JSON.parse(
      readFileSync(join(process.cwd(), 'openapi.json'), 'utf8'),
    );
    expect(unsortedEnumSites(committed)).toEqual([]);
  });

  it('describes no file route by a ReadStream schema (file routes are binary bodies)', () => {
    expect(document.components?.schemas).not.toHaveProperty('ReadStream');
  });

  it('documents no raw (unenveloped) route as application/json, since it sends a file or text', () => {
    const json = operations(document)
      .filter(({ operation }) => (operation as unknown as Flagged)['x-raw'])
      .filter(({ operation }) =>
        Object.keys(contentOf(operation)).includes('application/json'),
      )
      .map(({ label }) => label);
    expect(json).toEqual([]);
  });

  it('gives every event stream a body (server-sent events or NDJSON), and streams only under /events/', () => {
    const isStream = (operation: OperationObject) =>
      Object.values(operation.responses).some((response) =>
        Object.keys((response as { content?: object }).content ?? {}).some(
          (type) => STREAM_TYPES.includes(type),
        ),
      );
    const all = operations(document);
    const byBody = all.filter(({ operation }) => isStream(operation));
    const byPath = all.filter(({ label }) =>
      label.includes('/api/internal/events/'),
    );
    expect(byBody.length).toBeGreaterThan(0);
    expect(byBody.map(({ label }) => label).sort()).toEqual(
      byPath.map(({ label }) => label).sort(),
    );
  });
});
