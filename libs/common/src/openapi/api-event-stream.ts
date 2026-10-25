import { applyDecorators, SetMetadata } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/** Route metadata set by the stream decorators: the handler hijacks the reply, so nothing queued on it (a refreshed session cookie) is ever sent. */
export const STREAM_ROUTE = 'common:stream';

/**
 * Documents a server-sent event stream (`text/event-stream`): each frame is one of `frames`, a class with
 * `event` (the SSE event name, a literal or a list of literals) and `data` (the JSON payload).
 * No OpenAPI `discriminator` on purpose: `openapi-typescript` would replace the `event` literals by schema names.
 */
export const ApiEventStream = (...frames: Type[]) =>
  applyDecorators(
    SetMetadata(STREAM_ROUTE, true),
    ApiExtraModels(...frames),
    ApiOkResponse({
      description: 'A stream of frames; `event` names each one.',
      content: {
        'text/event-stream': {
          schema: {
            oneOf: frames.map((frame) => ({ $ref: getSchemaPath(frame) })),
          },
        },
      },
    }),
  );

/** Documents a stream of newline-delimited JSON (`application/x-ndjson`): each line is one `line` object; there are no SSE frames or event names. */
export const ApiNdjsonStream = (line: Type) =>
  applyDecorators(
    SetMetadata(STREAM_ROUTE, true),
    ApiExtraModels(line),
    ApiOkResponse({
      description: 'A stream of JSON objects, one per line.',
      content: {
        'application/x-ndjson': { schema: { $ref: getSchemaPath(line) } },
      },
    }),
  );
