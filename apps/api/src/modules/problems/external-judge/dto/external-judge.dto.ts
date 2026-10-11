import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const MAX_MAPPED_LANGUAGES = 200;
const MAX_TEXT = 100;

export class ExternalLanguageDto {
  /** Site language id. */
  @IsUUID() languageId!: string;
  /** The remote OJ's language id. */
  @IsString() @Length(1, MAX_TEXT) remoteId!: string;
  /** The remote OJ's language name, for display. */
  @IsOptional() @IsString() @MaxLength(MAX_TEXT) remoteName?: string;
}

export class PutExternalJudgeDto {
  /** Whether the problem is judged by the external judge. */
  @IsBoolean() isActive!: boolean;
  /** The external judge's OJ id (`CodeForces`, `QOJ`, ...). */
  @IsString() @Length(1, MAX_TEXT) oj!: string;
  /** The problem id on that OJ. */
  @IsString() @Length(1, MAX_TEXT) problemId!: string;
  /** The remote title from a verify; stamps the link as verified. */
  @IsOptional() @IsString() @MaxLength(MAX_TEXT * 3) title?: string;
  /** Site languages and the remote language each is sent as; at most one entry per site language. */
  @ArrayMaxSize(MAX_MAPPED_LANGUAGES)
  @ArrayUnique((entry: ExternalLanguageDto) => entry.languageId)
  @ValidateNested({ each: true })
  @Type(() => ExternalLanguageDto)
  languages!: ExternalLanguageDto[];
}

export class ExternalJudgeSearchDto {
  /** OJ id to search in. */
  @IsOptional() @IsString() @Length(1, MAX_TEXT) oj?: string;
  /** Problem id (or part of it) to search for. */
  @IsOptional() @IsString() @Length(1, MAX_TEXT) problemId?: string;
  /** Page, from 1. */
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;
}

export class ExternalJudgeVerifyDto {
  @IsString() @Length(1, MAX_TEXT) oj!: string;
  @IsString() @Length(1, MAX_TEXT) problemId!: string;
}
