import type { OpenAPIObject } from '@nestjs/swagger';
import { inlineEnumSites, looseSites } from './schema-scans';

const documentWith = (parts: {
  paths?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
}): OpenAPIObject =>
  ({
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: parts.paths ?? {},
    components: { schemas: parts.schemas ?? {} },
  }) as unknown as OpenAPIObject;

const ok = (data: unknown) => ({
  responses: {
    200: {
      description: 'ok',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { data }, required: ['data'] },
        },
      },
    },
  },
});

describe('looseSites', () => {
  it('flags a parameter that refers to the empty Object schema', () => {
    const document = documentWith({
      paths: {
        '/x': {
          get: {
            ...ok({ type: 'string' }),
            parameters: [
              {
                name: 'page',
                in: 'query',
                schema: { allOf: [{ $ref: '#/components/schemas/Object' }] },
              },
              { name: 'search', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
    });
    expect(looseSites(document)).toEqual(['GET /x parameter page']);
  });

  it('flags an empty schema and a bare-object property, not a free-form or referenced one', () => {
    const document = documentWith({
      schemas: {
        Empty: { type: 'object', properties: {} },
        Holder: {
          type: 'object',
          properties: {
            bare: { type: 'object' },
            free: { type: 'object', additionalProperties: true },
            ref: { allOf: [{ $ref: '#/components/schemas/Empty' }] },
            text: { type: 'string' },
          },
        },
      },
    });
    expect(looseSites(document)).toEqual([
      'schema Empty is empty',
      'schema Holder.bare is a bare object',
    ]);
  });

  it('flags a success response whose data is a bare object', () => {
    const document = documentWith({
      paths: {
        '/a': { post: ok({ type: 'object' }) },
        '/b': { post: ok({ type: 'object', additionalProperties: true }) },
      },
    });
    expect(looseSites(document)).toEqual(['POST /a 200 data is a bare object']);
  });
});

describe('inlineEnumSites', () => {
  it('finds an enumeration spelled inline in any member order, not the named component', () => {
    const document = documentWith({
      schemas: {
        Lang: { type: 'string', enum: ['vi', 'en'] },
        Post: {
          type: 'object',
          properties: {
            language: { type: 'string', enum: ['en', 'vi'] },
            languages: {
              type: 'array',
              items: { type: 'string', enum: ['vi', 'en'] },
            },
            other: { type: 'string', enum: ['a', 'b'] },
            named: { $ref: '#/components/schemas/Lang' },
          },
        },
      },
    });
    expect(inlineEnumSites(document, ['vi', 'en'])).toEqual([
      '/components/schemas/Post/properties/language',
      '/components/schemas/Post/properties/languages/items',
    ]);
  });
});
