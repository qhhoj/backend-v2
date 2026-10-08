import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  FLATPAGE_CONTENT_MAX_LENGTH,
  FLATPAGE_TITLE_MAX_LENGTH,
  FLATPAGE_URL_MAX_LENGTH,
} from '@libs/database';

/** No property initializers (`PartialType` would inherit them). */
export class CreateFlatpageDto {
  /** Canonicalised on save (`about/` becomes `/about`). */
  @IsString() @MaxLength(FLATPAGE_URL_MAX_LENGTH) url!: string;
  @IsString() @Length(1, FLATPAGE_TITLE_MAX_LENGTH) title!: string;
  /** Markdown, rendered and sanitised on save in the `solution` style. */
  @IsString() @MaxLength(FLATPAGE_CONTENT_MAX_LENGTH) content!: string;
  @IsOptional() @IsBoolean() registrationRequired?: boolean;
}

export class UpdateFlatpageDto extends PartialType(CreateFlatpageDto) {}
