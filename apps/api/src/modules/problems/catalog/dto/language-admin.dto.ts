import { LowercaseUuid } from '@libs/common';
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
const LANGUAGE_ORDER_MIN = -10_000;
const LANGUAGE_ORDER_MAX = 10_000;

/** No property initializers (`PartialType` would inherit them). */
export class CreateLanguageDto {
  /** Key judges report for the language; letters, digits and `_+#.-`, up to 10 characters. Fixed once created. */
  @Matches(LANGUAGE_KEY_PATTERN) key!: string;
  /** Display name, up to 20 characters. */
  @IsString() @Length(1, 20) name!: string;
  /** Short display name; omit for none. */
  @IsOptional() @IsString() @Length(1, 20) shortName?: string;
  /** Generic family name shared by versions of the language. */
  @IsString() @Length(1, 20) commonName!: string;
  /** Editor mode name for the code editor. */
  @IsString() @Length(1, 50) ace!: string;
  /** Syntax highlighter name. */
  @IsString() @Length(1, 50) pygments!: string;
  /** Starter code offered in the editor. */
  @IsOptional() @IsString() @MaxLength(LANGUAGE_TEXT_MAX) template?: string;
  /** Notes shown to users about the compiler or runtime. */
  @IsOptional() @IsString() @MaxLength(LANGUAGE_TEXT_MAX) info?: string;
  /** Longer description of the language. */
  @IsOptional() @IsString() @MaxLength(LANGUAGE_TEXT_MAX) description?: string;
  /** File extension without the dot. */
  @Matches(LANGUAGE_EXTENSION_PATTERN) extension!: string;
  /** Whether solutions are uploaded as a file instead of typed. */
  @IsOptional() @IsBoolean() fileOnly?: boolean;
  /** Largest uploaded file in MB; 0 turns uploads off. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(LANGUAGE_FILE_SIZE_LIMIT_MAX)
  fileSizeLimit?: number;
  /** Whether new problems allow this language by default. */
  @IsOptional() @IsBoolean() includeInProblem?: boolean;
  /** false hides it from the submit form and refuses new submissions in it. Default true. */
  @IsOptional() @IsBoolean() isActive?: boolean;
  /** Position in language lists (then name); lower first. Default 0. */
  @IsOptional()
  @IsInt()
  @Min(LANGUAGE_ORDER_MIN)
  @Max(LANGUAGE_ORDER_MAX)
  order?: number;
}

/** `shortName: null` clears it; the other fields refuse null (see `RefuseNullFieldsPipe`). */
export class UpdateLanguageDto extends PartialType(
  OmitType(CreateLanguageDto, ['key', 'shortName'] as const),
) {
  /** Short display name; null clears it. */
  @IsOptional() @IsString() @Length(1, 20) shortName?: string | null;
}

export class LanguageIdParamDto {
  /** Language id. */
  @LowercaseUuid() @IsUUID('7') id!: string;
}
