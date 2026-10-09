import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, operationOf } from './document';
import { looseSites } from './schema-scans';

const ROUTE = '/api/internal/problems/{code}/package';
type Media = Record<string, { schema?: SchemaObject }>;

describe('problem package schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const bodyOf = (method: 'get' | 'post', status: string): Media =>
    (
      operationOf(document, ROUTE, method).responses[status] as {
        content: Media;
      }
    ).content;

  it('streams the zip as a binary body', () => {
    expect(bodyOf('get', '200')['application/zip']?.schema).toEqual({
      type: 'string',
      format: 'binary',
    });
  });

  it('wraps the status bodies in data', () => {
    const wrapped = (media: Media, name: string) =>
      expect(media['application/json']?.schema).toMatchObject({
        required: ['data'],
        properties: { data: { $ref: `#/components/schemas/${name}` } },
      });
    wrapped(bodyOf('post', '200'), 'PackageStatusResponse');
    wrapped(bodyOf('post', '202'), 'PackageStatusResponse');
    wrapped(bodyOf('get', '202'), 'PackageBuildingResponse');
  });

  it('lists the status literals and the key', () => {
    const status = document.components?.schemas
      ?.PackageStatusResponse as SchemaObject;
    expect(status.properties?.status).toMatchObject({
      enum: ['ready', 'building'],
    });
    expect(status.required).toEqual(expect.arrayContaining(['status', 'key']));
  });

  it('has no loose site on the package routes and responses', () => {
    expect(
      looseSites(document).filter((site) =>
        /(\/package|Package(Status|Building)Response)\b/.test(site),
      ),
    ).toEqual([]);
  });
});
