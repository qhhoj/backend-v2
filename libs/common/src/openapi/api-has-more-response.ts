import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { HasMorePageMetaResponse } from './has-more-page-meta.response';

/** `ApiPaginatedResponse` for a `Paginated<Item>` whose meta is `{ page, pageSize, hasMore }` (no total). */
export const ApiHasMoreResponse = <Item extends Type>(item: Item) =>
  applyDecorators(
    ApiExtraModels(item, HasMorePageMetaResponse),
    ApiExtension('x-enveloped', true),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(item) } },
          meta: { $ref: getSchemaPath(HasMorePageMetaResponse) },
        },
      },
    }),
  );
