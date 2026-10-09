import { applyDecorators } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import {
  ApiExtension,
  ApiExtraModels,
  ApiOkResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { CursorPageMetaResponse } from './cursor-page-meta.response';

/** `ApiPaginatedResponse` for a `Paginated<Item, CursorPageMetaResponse>` whose meta is `{ pageSize, nextBefore }`. */
export const ApiCursorResponse = <Item extends Type>(item: Item) =>
  applyDecorators(
    ApiExtraModels(item, CursorPageMetaResponse),
    ApiExtension('x-enveloped', true),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array', items: { $ref: getSchemaPath(item) } },
          meta: { $ref: getSchemaPath(CursorPageMetaResponse) },
        },
      },
    }),
  );
