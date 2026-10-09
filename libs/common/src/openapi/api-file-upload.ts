import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';

/** Documents a route whose body is multipart with exactly one binary `file` part (the handler reads the raw request, so Nest cannot infer a body). */
export const ApiFileUpload = () =>
  applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file'],
        properties: { file: { type: 'string', format: 'binary' } },
      },
    }),
  );
