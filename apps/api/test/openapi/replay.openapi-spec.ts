import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { loadDocument, parameterOf } from './document';
import { looseSites } from './schema-scans';

const REPLAY_ROUTE = '/api/internal/contests/{key}/replay';

describe('replay schemas', () => {
  let document: OpenAPIObject;
  beforeAll(async () => {
    document = await loadDocument();
  });
  const schema = (name: string) => {
    const found = document.components?.schemas?.[name];
    if (!found) throw new Error(`The document has no schema ${name}`);
    return found as SchemaObject;
  };

  it('has no untyped parameter, empty schema or bare object on the replay routes and schemas', () => {
    expect(
      looseSites(document).filter((site) => /\/replay|Replay/.test(site)),
    ).toEqual([]);
  });

  it('types the chunk index as an optional number and the build id as an optional string', () => {
    expect(
      parameterOf(document, { route: REPLAY_ROUTE, method: 'get' }, 'chunk'),
    ).toMatchObject({
      required: false,
      schema: { type: 'number', minimum: 0 },
    });
    expect(
      parameterOf(document, { route: REPLAY_ROUTE, method: 'get' }, 'build'),
    ).toMatchObject({
      required: false,
      schema: { type: 'string' },
    });
  });

  it('lists exactly the members of the replay answer', () => {
    expect(Object.keys(schema('ReplayResponse').properties!).sort()).toEqual([
      'buildId',
      'builtAt',
      'chunk',
      'chunkCount',
      'events',
      'ghosts',
      'participants',
      'problems',
      'state',
    ]);
  });

  it('types the event tuples as arrays of numbers around one free-form cell, not as empty items', () => {
    const items = (schema('ReplayResponse').properties!.events as SchemaObject)
      .items as SchemaObject;
    expect(items).toMatchObject({
      type: 'array',
      items: { oneOf: [{ type: 'number' }, { type: 'object' }] },
    });
    expect(
      JSON.stringify(schema('ReplayGhostResponse').properties!.events),
    ).not.toContain('"items":{}');
  });

  it('types the chunk-0 lists as nullable arrays of their classes, and the ghost gap by its named enum', () => {
    expect(
      JSON.stringify(schema('ReplayResponse').properties!.participants),
    ).toContain('#/components/schemas/ReplayParticipantResponse');
    expect(
      JSON.stringify(schema('ReplayResponse').properties!.problems),
    ).toContain('#/components/schemas/ReplayProblemResponse');
    expect(
      JSON.stringify(schema('ReplayResponse').properties!.ghosts),
    ).toContain('#/components/schemas/ReplayGhostResponse');
    expect(
      JSON.stringify(schema('ReplayGhostResponse').properties!.gap),
    ).toContain('#/components/schemas/GhostGap');
  });
});
