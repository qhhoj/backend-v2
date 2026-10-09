import { PROBLEM_CODE_PATTERN, PROBLEM_LIMITS } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toArray, toBoolean } from '../../core/dto/transforms';

export const IMPORT_MODES = ['create', 'update'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];
/** `english=en`: a Polygon statement language and the site language its translation is stored under. */
const LANGUAGE_PAIR = /^[a-z]+=(en|vi)$/;

/** Options travel in the query string: the multipart body carries only the package. */
export class PolygonImportQueryDto {
  @Matches(PROBLEM_CODE_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  code!: string;
  @IsOptional() @IsIn(IMPORT_MODES) mode: ImportMode = 'create';
  @IsOptional()
  @Transform(toArray)
  @IsUUID('7', { each: true })
  authors?: string[];
  @IsOptional()
  @Transform(toArray)
  @IsUUID('7', { each: true })
  curators?: string[];
  @IsOptional() @IsUUID('7') groupId?: string;
  @IsOptional()
  @Transform(toArray)
  @IsUUID('7', { each: true })
  typeIds?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PROBLEM_LIMITS.points.min)
  @Max(PROBLEM_LIMITS.points.max)
  points?: number;
  @IsOptional() @IsString() @MaxLength(30) mainStatementLanguage?: string;
  @IsOptional()
  @Transform(toArray)
  @Matches(LANGUAGE_PAIR, { each: true })
  statementLanguages?: string[];
  @IsOptional() @IsString() @MaxLength(30) tutorialLanguage?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ignoreZeroPointBatches: boolean = false;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ignoreZeroPointCases: boolean = false;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  appendMainSolution: boolean = false;
}

export class ImportJobParamDto {
  @IsUUID('7') jobId!: string;
}
