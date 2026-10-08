import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NAVIGATION_KEY_MAX,
  NAVIGATION_LABEL_MAX,
  NAVIGATION_PATH_MAX,
  NAVIGATION_REGEX_MAX,
} from '@libs/database';

export const NAVIGATION_ORDER_MAX = 1_000_000;

/** No property initializers (`PartialType` would inherit them). */
export class CreateNavigationItemDto {
  @IsString() @Length(1, NAVIGATION_KEY_MAX) key!: string;
  @IsString() @Length(1, NAVIGATION_LABEL_MAX) label!: string;
  /** A site path (`/problems`) or an http(s) URL. */
  @IsString() @MaxLength(NAVIGATION_PATH_MAX) path!: string;
  /** A JavaScript regular expression the SPA tests against the current path (marks the entry active). */
  @IsOptional() @IsString() @MaxLength(NAVIGATION_REGEX_MAX) regex?: string;
  @IsOptional() @IsBoolean() hidden?: boolean;
  @IsInt() @Min(0) @Max(NAVIGATION_ORDER_MAX) order!: number;
  /** Id of an existing entry; absent or `null` = top level. */
  @IsOptional() @IsString() parentId?: string | null;
}

/** `parentId: null` moves the entry to the top level; the other fields refuse null. */
export class UpdateNavigationItemDto extends PartialType(
  CreateNavigationItemDto,
) {}
