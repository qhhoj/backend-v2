import type {
  OpenAPIObject,
  OperationObject,
  ResponseObject,
} from '@nestjs/swagger';

/** Success statuses whose JSON body the response interceptor wraps in `{ data }` (204 has none). */
const WRAPPED_STATUS = /^2\d\d$/;

/** Documents the wire envelope: `x-raw` (legacy shapes, files) and `x-enveloped` (paginated routes, which spell it out) are left as they are. */
export function envelopeResponses(document: OpenAPIObject): OpenAPIObject {
  for (const methods of Object.values(document.paths))
    for (const operation of Object.values(methods) as Array<
      OperationObject & Record<string, unknown>
    >) {
      if (operation['x-raw'] || operation['x-enveloped']) continue;
      for (const [status, response] of Object.entries(
        operation.responses ?? {},
      )) {
        if (!WRAPPED_STATUS.test(status)) continue;
        const media = (response as ResponseObject).content?.[
          'application/json'
        ];
        if (media?.schema)
          media.schema = {
            type: 'object',
            required: ['data'],
            properties: { data: media.schema },
          };
      }
    }
  return document;
}
