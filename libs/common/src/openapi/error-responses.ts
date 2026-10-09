import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';

const ERROR_SCHEMA = '#/components/schemas/ErrorResponse';

/** Any answer that is not a 2xx: `{ error: { code, message, fields?, issues?, ...extra } }`. */
const ERROR_RESPONSE = {
  description:
    'Any failure. `error.code` is a snake_case machine code; `fields` and `issues` appear on validation failures; some codes add members of their own (`banReason`).',
  headers: {
    'Retry-After': {
      description:
        'Whole seconds to wait before retrying; sent with 429 and 503.',
      schema: { type: 'integer', minimum: 1 },
    },
  },
  content: { 'application/json': { schema: { $ref: ERROR_SCHEMA } } },
} as const;

/**
 * Documents the error envelope on every operation as the `default` response (a route that spells out its own `default` keeps it),
 * and says `ErrorBodyResponse` may carry members beyond the listed ones (`AppError.extra`).
 */
export function errorResponses(document: OpenAPIObject): OpenAPIObject {
  for (const methods of Object.values(document.paths))
    for (const operation of Object.values(methods) as OperationObject[])
      operation.responses.default ??= ERROR_RESPONSE as never;
  const body = document.components?.schemas?.ErrorBodyResponse;
  if (body && !('$ref' in body)) body.additionalProperties = true;
  return document;
}
