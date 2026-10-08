import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { MISC_CONFIG_KEY_MAX } from '@libs/database';

/** Unvalidated: a malformed id is a 404. */
export class SiteIdParamDto {
  @IsString() id!: string;
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
