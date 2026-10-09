import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { BALLOON_STATES } from '../../src/modules/contests/balloons/dto/balloons.dto';
import { loadDocument, operationOf, parameterOf } from './document';
import { inlineEnumSites, looseSites } from './schema-scans';

const LIST = {
  route: '/api/internal/contests/{key}/balloons',
  method: 'get',
} as const;
const ITEM = '/api/internal/contests/{key}/balloons/{participation}/{problem}';

describe('balloon routes', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) =>
    document.components?.schemas?.[name] as SchemaObject;

  it('has no loose site on the balloon routes and DTOs', () => {
    const own = looseSites(document).filter(
      (site) => site.includes('/balloons') || /^schema Balloon\w*\b/.test(site),
    );
    expect(own).toEqual([]);
  });

  it('types the paging as optional numbers within their bounds', () => {
    expect(parameterOf(document, LIST, 'page')).toMatchObject({
      required: false,
      schema: { type: 'number', minimum: 1, maximum: 10000 },
    });
    expect(parameterOf(document, LIST, 'pageSize')).toMatchObject({
      required: false,
      schema: { type: 'number', minimum: 1, maximum: 100 },
    });
  });

  it('names the state filter once, as an optional BalloonState', () => {
    const state = parameterOf(document, LIST, 'state');
    expect(state.required).toBe(false);
    expect(JSON.stringify(state.schema)).toContain(
      '#/components/schemas/BalloonState',
    );
    expect(schema('BalloonState').enum).toHaveLength(BALLOON_STATES.length);
    expect(inlineEnumSites(document, BALLOON_STATES)).toEqual([]);
  });

  it('documents the nullable freeze-hidden numbers and the badge totals in the page meta', () => {
    const item = schema('BalloonResponse').properties as Record<
      string,
      SchemaObject
    >;
    expect(item.solvedAt.nullable).toBe(true);
    const meta = schema('BalloonPageMetaResponse').properties as Record<
      string,
      SchemaObject
    >;
    expect(meta.pendingTotal.nullable).toBe(true);
    expect(meta.deliveredTotal.nullable).toBe(true);
    expect(Object.keys(meta)).toEqual(
      expect.arrayContaining(['page', 'pageSize', 'total']),
    );
  });

  it('answers deliver and undeliver with 204', () => {
    for (const action of ['deliver', 'undeliver'])
      expect(
        operationOf(document, `${ITEM}/${action}`, 'post').responses,
      ).toHaveProperty('204');
  });
});
