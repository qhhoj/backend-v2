import { getMetadataStorage } from 'class-validator';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import {
  CONTEST_FORMAT_NAMES,
  LABEL_STYLES,
  STATEMENT_LANGUAGES,
  SUBMISSION_RESULTS,
  SUBMISSION_STATUSES,
} from '@libs/database';
import { loadDocument } from './document';
import {
  duplicateEnums,
  inlineEnumSites,
  looseSites,
  namedEnumsWith,
} from './schema-scans';

type Metadatas = Map<{ name: string }, Array<{ propertyName: string }>>;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const STREAM_TYPES = ['text/event-stream', 'application/x-ndjson'];

/** Each scan below covers route sites (`GET /x ...`) and schema sites (`schema Name...`, `/components/schemas/Name/...`): never filter them by a route prefix. */
describe('OpenAPI schema quality', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has no untyped parameter, empty schema or bare object (free-form ones say additionalProperties)', () => {
    expect(looseSites(document)).toEqual([]);
  });

  it('documents every validated DTO property (the plugin drops what it cannot type)', () => {
    const validated = (
      getMetadataStorage() as unknown as { validationMetadatas: Metadatas }
    ).validationMetadatas;
    const schemas = document.components?.schemas ?? {};
    const missing: string[] = [];
    for (const [target, metadatas] of validated) {
      const schema = schemas[target.name] as
        { properties?: object } | undefined;
      if (!schema) continue;
      for (const { propertyName } of metadatas)
        if (!(propertyName in (schema.properties ?? {})))
          missing.push(`${target.name}.${propertyName}`);
    }
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

  it('describes no file route by a ReadStream schema (file routes are binary bodies)', () => {
    expect(document.components?.schemas).not.toHaveProperty('ReadStream');
  });

  it('gives every event stream a body (server-sent events or NDJSON)', () => {
    const streams = Object.entries(document.paths).filter(([route]) =>
      route.startsWith('/api/internal/events/'),
    );
    expect(streams.length).toBeGreaterThan(0);
    for (const [route, item] of streams) {
      const content = (item.get as OperationObject).responses['200'] as {
        content?: Record<string, unknown>;
      };
      const types = Object.keys(content.content ?? {});
      expect({
        route,
        ok: types.some((type) => STREAM_TYPES.includes(type)),
      }).toEqual({ route, ok: true });
    }
  });
});
