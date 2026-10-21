import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { POLYGON_IMPORT_ERROR_CODES } from '@libs/problems';

/** Why an import or sync failed, as the code the UI translates (`PolygonImportErrorCode`); null when it did not fail, and on failures recorded before codes. */
export const ApiImportErrorCode = () =>
  applyDecorators(
    ApiProperty({
      enum: POLYGON_IMPORT_ERROR_CODES,
      enumName: 'PolygonImportErrorCode',
      nullable: true,
    }),
  );

/** What the error text interpolates: `{count, limit}`, `{languages}`, `{language}`, `{usedBytes, limitBytes, neededBytes}`; null with no error code. */
export const ApiImportErrorParams = () =>
  applyDecorators(
    ApiProperty({
      type: 'object',
      nullable: true,
      additionalProperties: {
        oneOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'array', items: { type: 'string' } },
        ],
      },
    }),
  );
