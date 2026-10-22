import { LowercaseUuid } from '@libs/common';
import { PartialType } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const LICENSE_TEXT_MAX = 65_536;
const URL_MAX = 200;
/** The key appears in license URLs: letters, digits, dots, dashes and underscores. */
const LICENSE_KEY_PATTERN = /^[A-Za-z0-9._-]{1,20}$/;
/** Empty, or an http(s) URL: the link and icon render on public problem pages, so no `javascript:` and the like. */
const OPTIONAL_HTTP_URL = /^(https?:\/\/\S+)?$/;

export class CatalogIdParamDto {
  /** Catalog row id. */
  @LowercaseUuid() @IsUUID('7') id!: string;
}

/** A problem type or problem group. No property initializers (`PartialType` would inherit them). */
export class CreateTaxonDto {
  /** Short name, unique ignoring case, up to 20 characters. */
  @IsString() @Length(1, 20) name!: string;
  /** Full display name, up to 100 characters. */
  @IsString() @Length(1, 100) fullName!: string;
}

export class UpdateTaxonDto extends PartialType(CreateTaxonDto) {}

export class CreateLicenseDto {
  /** Unique key, ignoring case: letters, digits, `.`, `_` and `-`, up to 20 characters. */
  @Matches(LICENSE_KEY_PATTERN) key!: string;
  /** License name, up to 256 characters. */
  @IsString() @Length(1, 256) name!: string;
  /** URL of the full license text: http(s), or empty for none. */
  @IsOptional()
  @IsString()
  @MaxLength(URL_MAX)
  @Matches(OPTIONAL_HTTP_URL)
  link?: string;
  /** Short text shown beside problems under this license. */
  @IsOptional() @IsString() @MaxLength(256) display?: string;
  /** URL of the license icon: http(s), or empty for none. */
  @IsOptional()
  @IsString()
  @MaxLength(URL_MAX)
  @Matches(OPTIONAL_HTTP_URL)
  icon?: string;
  /** License text in markdown. */
  @IsOptional() @IsString() @MaxLength(LICENSE_TEXT_MAX) text?: string;
}

export class UpdateLicenseDto extends PartialType(CreateLicenseDto) {}
