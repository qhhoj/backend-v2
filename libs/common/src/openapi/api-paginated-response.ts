import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { PageMetaResponse } from './page-meta.response';

/** Documents a `Paginated<Item>` return: `{ data: Item[], meta }` (the interceptor's envelope, spelled out). */
export const ApiPaginatedResponse = <Item extends Type>(item: Item) =>
  applyDecorators(
    ApiExtraModels(item, PageMetaResponse),
    ApiExtension('x-enveloped', true),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(item) } },
          meta: { $ref: getSchemaPath(PageMetaResponse) },
        },
      },
    }),
  );
