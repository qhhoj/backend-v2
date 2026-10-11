import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MISC_CONFIG_KEY_MAX } from '@libs/database';
import { IsStoredUuid } from '../../../users/core/dto/is-stored-uuid';

/** Unvalidated: a malformed id is a 404. */
export class SiteIdParamDto {
  /** Id of the entry; an unknown or malformed id gives 404. */
  @IsString() id!: string;
}

/** A malformed id is a 400 here: a history read is by id only, so the id must be a real one. */
export class FlatpageIdParamDto {
  /** Page id, also of a deleted page. */
  @IsStoredUuid() id!: string;
}

export class ConfigKeyParamDto {
  /** Config key, 1-64 characters without control characters. */
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^\u0000-\u001f\u007f]*$/, { message: 'No control characters.' })
  @Length(1, MISC_CONFIG_KEY_MAX)
  key!: string;
}

export class PageListQueryDto {
  /** Page number, starting at 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

export class FlatpageListQueryDto extends PageListQueryDto {
  /** Keeps pages whose url or title contains this text, any case. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
