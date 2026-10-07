import { PartialType } from '@nestjs/swagger';
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

/** No property initializers (see `CreateProblemDto`): `PartialType` would inherit them. */
export class CreateOrganizationDto {
  @IsString() @Length(1, 128) name!: string;
  @IsString()
  @MaxLength(128)
  @Matches(ORGANIZATION_SLUG_PATTERN, {
    message: 'Starts with a letter; letters, digits, - and _.',
  })
  slug!: string;
  @IsOptional() @IsString() @MaxLength(ABOUT_MAX_LENGTH) about?: string;
  @IsOptional() @IsBoolean() isOpen?: boolean;
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(LOGO_PATTERN)
  logoOverrideImage?: string;
  /** Admins besides the creator on create; the whole list on edit. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('7', { each: true })
  adminIds?: string[];
  /** Staff fields (`judge.edit_all_organization`). */
  @IsOptional() @IsBoolean() isUnlisted?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000) slots?: number | null;
  @IsOptional() @IsString() @Length(1, 20) shortName?: string;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}
