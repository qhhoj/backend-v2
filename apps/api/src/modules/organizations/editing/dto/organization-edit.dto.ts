import { LowercaseUuid } from '@libs/common';
import { ApiProperty, PartialType } from '@nestjs/swagger';
import { ABOUT_MAX_LENGTH } from '@libs/community';
import { ORGANIZATION_SLUG_PATTERN } from '@libs/database';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Empty, an http(s) URL or a site path (legacy free text up to 150). */
const LOGO_PATTERN = /^(|https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/;

/** Static route `GET /organizations/usage` wins over `:slug`, so the word cannot be a slug (any case). */
export const RESERVED_ORGANIZATION_SLUG_PATTERN = /^(?!usage$)/i;

/** No property initializers (see `CreateProblemDto`): `PartialType` would inherit them. */
export class CreateOrganizationDto {
  /** Organization name, 1 to 128 characters. */
  @IsString() @Length(1, 128) name!: string;
  /**
   * Unique identifier used in URLs: starts with a letter, then letters,
   * digits, hyphens and underscores; the word usage is reserved.
   */
  @ApiProperty({ pattern: ORGANIZATION_SLUG_PATTERN.source, maxLength: 128 })
  @IsString()
  @MaxLength(128)
  @Matches(ORGANIZATION_SLUG_PATTERN, {
    message: 'Starts with a letter; letters, digits, - and _.',
  })
  @Matches(RESERVED_ORGANIZATION_SLUG_PATTERN, {
    message: 'This slug is reserved.',
  })
  slug!: string;
  /** Markdown about text, rendered to HTML when saved. */
  @IsOptional() @IsString() @MaxLength(ABOUT_MAX_LENGTH) about?: string;
  /** Whether anyone may join without a request. */
  @IsOptional() @IsBoolean() isOpen?: boolean;
  /** Empty, an http or https URL, or a site path, at most 150 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(LOGO_PATTERN)
  logoOverrideImage?: string;
  /** Admins besides the creator on create; the whole list on edit. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  adminIds?: string[];
  /** Staff fields (`judge.edit_all_organization`). */
  @IsOptional() @IsBoolean() isUnlisted?: boolean;
  /** Most members allowed; null for no limit. */
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) slots?: number | null;
  /**
   * Short name shown beside members, 1 to 20 characters; defaults to the start
   * of the slug.
   */
  @IsOptional() @IsString() @Length(1, 20) shortName?: string;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}
