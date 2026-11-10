import { Socket } from 'node:net';
import { canonicalJson } from '@libs/common';
import type { OperationObject } from '@nestjs/swagger';
import { AppModule } from '../../src/app.module';
import { API_SECTIONS } from '../../src/openapi';
import {
  buildDocument,
  collectControllers,
  loadDocument,
  operationOf,
  parameterOf,
} from './document';

jest.setTimeout(30_000);

/** The liveness probe is not part of the API reference (swagger tags it `Health`, after its controller). */
const OUTSIDE_SECTIONS = ['get /healthz'];

describe('the offline OpenAPI document', () => {
  it('collects each controller of the app once, through nested and dynamic modules', () => {
    const controllers = collectControllers(AppModule);
    const names = controllers.map((controller) => controller.name);
    expect(new Set(controllers).size).toBe(controllers.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'AuthController',
        'ContestsController',
        'ProblemsController',
      ]),
    );
  });

  it('files every operation under exactly one API section, and leaves no section empty', async () => {
    const document = await loadDocument();
    const sections = API_SECTIONS.map(([name]) => name);
    const operations = Object.entries(document.paths).flatMap(([route, item]) =>
      (['get', 'put', 'post', 'delete', 'patch', 'head'] as const)
        .filter((method) => item[method])
        .map((method) => ({
          operation: `${method} ${route}`,
          tags: (item[method] as OperationObject).tags ?? [],
        })),
    );
    expect(
      operations
        .filter(({ tags }) => tags.length !== 1 || !sections.includes(tags[0]))
        .map(({ operation }) => operation),
    ).toEqual(OUTSIDE_SECTIONS);
    expect(
      sections.filter(
        (section) => !operations.some(({ tags }) => tags[0] === section),
      ),
    ).toEqual([]);
  });

  it('lists routes from deeply nested modules', async () => {
    const document = await loadDocument();
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/internal/auth/login',
        '/api/internal/contests/{key}/ranking',
        '/api/internal/admin/user-activity/live',
        '/api/internal/events/submissions',
      ]),
    );
    expect(
      operationOf(document, '/api/internal/problems', 'get'),
    ).toBeDefined();
    expect(
      parameterOf(
        document,
        { route: '/api/internal/problems', method: 'get' },
        'search',
      ),
    ).toMatchObject({ in: 'query', required: false });
  });

  it('refuses to describe a route or parameter the document does not have', async () => {
    const document = await loadDocument();
    expect(() => operationOf(document, '/api/internal/nope', 'get')).toThrow(
      /no get/,
    );
    expect(() =>
      parameterOf(
        document,
        { route: '/api/internal/problems', method: 'get' },
        'nope',
      ),
    ).toThrow(/no parameter nope/);
  });

  it('opens no connection while building', async () => {
    const connect = jest.spyOn(Socket.prototype, 'connect');
    await buildDocument();
    expect(connect).not.toHaveBeenCalled();
    connect.mockRestore();
  });

  it('serialises to the same text every time it is built', async () => {
    expect(canonicalJson(await buildDocument())).toBe(
      canonicalJson(await loadDocument()),
    );
  });
});
