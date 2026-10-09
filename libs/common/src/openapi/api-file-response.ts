import { ApiOkResponse } from '@nestjs/swagger';

/** Documents a route that answers with a file (it is `@RawResponse()`: no `{ data }` envelope): `contentType` with a binary body. */
export const ApiFileResponse = (contentType: string) =>
  ApiOkResponse({
    description: 'The file, as an attachment.',
    content: {
      [contentType]: { schema: { type: 'string', format: 'binary' } },
    },
  });
