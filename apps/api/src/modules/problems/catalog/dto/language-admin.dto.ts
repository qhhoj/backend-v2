import { OmitType, PartialType } from '@nestjs/swagger';
import {
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
import { LANGUAGE_EXTENSION_PATTERN } from '@libs/database';

/** A judge reports languages by key, so the key is fixed once created. */
const LANGUAGE_KEY_PATTERN = /^[A-Za-z0-9_+#.-]{1,10}$/;
const LANGUAGE_FILE_SIZE_LIMIT_MAX = 1_073_741_824;
const LANGUAGE_TEXT_MAX = 65_536;

/** No property initializers (`PartialType` would inherit them). */
export class CreateLanguageDto {
  @Matches(LANGUAGE_KEY_PATTERN) key!: string;
  @IsString() @Length(1, 20) name!: string;
  @IsOptional() @IsString() @Length(1, 20) shortName?: string;
  @IsString() @Length(1, 20) commonName!: string;
  @IsString() @Length(1, 50) ace!: string;
  @IsString() @Length(1, 50) pygments!: string;
  @IsOptional() @IsString() @MaxLength(LANGUAGE_TEXT_MAX) template?: string;
  @IsOptional() @IsString() @MaxLength(LANGUAGE_TEXT_MAX) info?: string;
  @IsOptional() @IsString() @MaxLength(LANGUAGE_TEXT_MAX) description?: string;
  @Matches(LANGUAGE_EXTENSION_PATTERN) extension!: string;
  @IsOptional() @IsBoolean() fileOnly?: boolean;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(LANGUAGE_FILE_SIZE_LIMIT_MAX)
  fileSizeLimit?: number;
  @IsOptional() @IsBoolean() includeInProblem?: boolean;
}

/** `shortName: null` clears it; the other fields refuse null (see `RefuseNullFieldsPipe`). */
export class UpdateLanguageDto extends PartialType(
  OmitType(CreateLanguageDto, ['key'] as const),
) {}

export class LanguageIdParamDto {
  @IsUUID('7') id!: string;
}
