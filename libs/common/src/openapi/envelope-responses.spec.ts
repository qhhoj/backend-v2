import type { OpenAPIObject } from '@nestjs/swagger';
import { envelopeResponses } from './envelope-responses';

type Operation = {
  responses: Record<string, { content?: Record<string, { schema?: object }> }>;
};

const document = (operations: Record<string, object>): OpenAPIObject => ({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: { '/x': operations },
});
const ok = (schema: object, extra: object = {}) => ({
  responses: {
    200: { description: 'ok', content: { 'application/json': { schema } } },
  },
  ...extra,
});

describe('envelopeResponses', () => {
  it('wraps a JSON body in data, like the wire format', () => {
    const wrapped = envelopeResponses(
      document({ get: ok({ $ref: '#/components/schemas/A' }) }),
    );
    expect(
      (wrapped.paths['/x'].get as unknown as Operation).responses['200']
        .content!['application/json'].schema,
    ).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { $ref: '#/components/schemas/A' } },
    });
  });
  it('wraps every 2xx JSON body, 202 included', () => {
    const accepted = {
      responses: {
        202: {
          description: 'accepted',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    };
    const wrapped = envelopeResponses(document({ post: accepted }));
    expect(
      (wrapped.paths['/x'].post as unknown as Operation).responses['202']
        .content!['application/json'].schema,
    ).toEqual({
      type: 'object',
      required: ['data'],
      properties: { data: { type: 'object' } },
    });
  });
  it('leaves raw and already-enveloped operations alone', () => {
    const raw = ok({ $ref: '#/components/schemas/Legacy' }, { 'x-raw': true });
    const paged = ok({ type: 'object' }, { 'x-enveloped': true });
    const result = envelopeResponses(document({ get: raw, post: paged }));
    expect(result.paths['/x'].get).toEqual(raw);
    expect(result.paths['/x'].post).toEqual(paged);
  });
});
