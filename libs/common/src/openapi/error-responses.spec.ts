import type { OpenAPIObject } from '@nestjs/swagger';
import { errorResponses } from './error-responses';

const document = (responses: Record<string, unknown>): OpenAPIObject =>
  ({
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: {
      '/x': {
        get: { responses },
        delete: { responses: { 204: { description: 'gone' } } },
      },
    },
    components: {
      schemas: { ErrorBodyResponse: { type: 'object', properties: {} } },
    },
  }) as unknown as OpenAPIObject;

type Responses = Record<string, Record<string, unknown>>;
const responsesOf = (doc: OpenAPIObject, method: 'get' | 'delete') =>
  (doc.paths['/x'][method] as unknown as { responses: Responses }).responses;

describe('errorResponses', () => {
  it('documents the error envelope as the default response of every operation', () => {
    const result = errorResponses(document({ 200: { description: 'ok' } }));
    for (const method of ['get', 'delete'] as const)
      expect(responsesOf(result, method).default).toMatchObject({
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ErrorResponse' },
          },
        },
      });
  });

  it('keeps a default response a route spells out itself, and every success response', () => {
    const own = { description: 'mine' };
    const result = errorResponses(
      document({ 200: { description: 'ok' }, default: own }),
    );
    expect(responsesOf(result, 'get').default).toBe(own);
    expect(Object.keys(responsesOf(result, 'delete'))).toEqual([
      '204',
      'default',
    ]);
  });
});
