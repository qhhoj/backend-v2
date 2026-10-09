import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Documents a server-sent event stream (`text/event-stream`): each frame is one of `frames`, a class with
 * `event` (the SSE event name, a literal or a list of literals) and `data` (the JSON payload).
 * No OpenAPI `discriminator` on purpose: `openapi-typescript` would replace the `event` literals by schema names.
 */
export const ApiEventStream = (...frames: Type[]) =>
  applyDecorators(
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
