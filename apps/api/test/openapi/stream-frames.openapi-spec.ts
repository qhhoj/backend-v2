import type { OpenAPIObject } from '@nestjs/swagger';
import { frameDataKeys, streamEventNames } from './stream-frames';

const frameRef = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const streamRoute = (frames: string[]) => ({
  get: {
    responses: {
      200: {
        description: 'ok',
        content: {
          'text/event-stream': { schema: { oneOf: frames.map(frameRef) } },
        },
      },
    },
  },
});
const document = {
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: {
    '/feed': streamRoute(['StateFrame', 'ProgressFrame']),
    '/bare': streamRoute(['BareFrame']),
  },
  components: {
    schemas: {
      StateFrame: {
        type: 'object',
        properties: {
          event: { type: 'string', enum: ['state'] },
          data: frameRef('Payload'),
        },
      },
      ProgressFrame: {
        type: 'object',
        properties: {
          event: { type: 'string', enum: ['queued', 'done'] },
          data: {
            allOf: [frameRef('Payload')],
            description: 'wrapped by the plugin',
          },
        },
      },
      OpenFrame: {
        type: 'object',
        properties: {
          event: { type: 'string', enum: ['resync'] },
          data: { type: 'object', additionalProperties: true },
        },
      },
      BareFrame: { type: 'object', properties: { event: { type: 'string' } } },
      Payload: {
        type: 'object',
        properties: { zeta: { type: 'string' }, alpha: { type: 'string' } },
      },
    },
  },
} as unknown as OpenAPIObject;

describe('stream frame helpers', () => {
  it('flattens the event names of every frame of a stream in document order', () => {
    expect(streamEventNames(document, '/feed')).toEqual([
      'state',
      'queued',
      'done',
    ]);
  });

  it('refuses a frame that has no event literal', () => {
    expect(() => streamEventNames(document, '/bare')).toThrow(
      'BareFrame has no `event` literal',
    );
  });

  it('lists the payload members sorted, through a reference or the plugin allOf wrapper', () => {
    expect(frameDataKeys(document, 'StateFrame')).toEqual(['alpha', 'zeta']);
    expect(frameDataKeys(document, 'ProgressFrame')).toEqual(['alpha', 'zeta']);
  });

  it('lists no members for a free-form payload and refuses an unknown frame', () => {
    expect(frameDataKeys(document, 'OpenFrame')).toEqual([]);
    expect(() => frameDataKeys(document, 'Nope')).toThrow(
      'The document has no schema Nope',
    );
  });
});
