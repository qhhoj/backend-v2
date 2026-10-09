import type { OpenAPIObject } from '@nestjs/swagger';
import { loadDocument, operationOf, parameterOf } from './document';
import { looseSites } from './schema-scans';

describe('canned reply routes', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });

  it('has no untyped parameter, empty schema or bare object on its own routes and schemas', () => {
    const own = looseSites(document).filter((site) =>
      /ticket-canned-replies|CannedReply/.test(site),
    );
    expect(own).toEqual([]);
  });

  it('types the list page as an optional number within its bounds', () => {
    const route = {
      route: '/api/internal/ticket-canned-replies',
      method: 'get',
    } as const;
    expect(parameterOf(document, route, 'page')).toMatchObject({
      required: false,
      schema: { type: 'number', minimum: 1, maximum: 10000, default: 1 },
    });
  });

  it('documents the four routes', () => {
    const base = '/api/internal/ticket-canned-replies';
    expect(operationOf(document, base, 'get')).toBeDefined();
    expect(operationOf(document, base, 'post')).toBeDefined();
    expect(operationOf(document, `${base}/{id}`, 'patch')).toBeDefined();
    expect(operationOf(document, `${base}/{id}`, 'delete')).toBeDefined();
  });
});
