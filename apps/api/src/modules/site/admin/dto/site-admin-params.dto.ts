import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateBy,
} from 'class-validator';
import { isUuid, MISC_CONFIG_KEY_MAX } from '@libs/database';

/** Unvalidated: a malformed id is a 404. */
export class SiteIdParamDto {
  @IsString() id!: string;
}

/** A malformed id is a 400 here: a history read is by id only, so the id must be a real one. */
export class FlatpageIdParamDto {
  @ValidateBy({
    name: 'isStoredUuid',
    validator: {
      validate: (value) => typeof value === 'string' && isUuid(value),
      defaultMessage: () => 'Not a valid id.',
    },
  })
  id!: string;
}

export class ConfigKeyParamDto {
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001f\u007f]*$/, { message: 'No control characters.' })
  @Length(1, MISC_CONFIG_KEY_MAX)
  key!: string;
}

export class PageListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}
