import { ApiOkResponse } from '@nestjs/swagger';

/** Documents a `@RawResponse()` route that answers with text (YAML, XML) in one of `contentTypes`: no `{ data }` envelope. */
export const ApiTextResponse = (...contentTypes: string[]) =>
  ApiOkResponse({
    content: Object.fromEntries(
      contentTypes.map((type) => [type, { schema: { type: 'string' } }]),
    ),
  });
