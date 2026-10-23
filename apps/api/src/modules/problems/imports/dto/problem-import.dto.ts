import { PROBLEM_LIMITS } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
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
import { IsProblemCode } from '../../core/dto/problem-code.decorator';
import { toArray, LowercaseUuid } from '@libs/common';
import { SYNC_JOB_ID } from '@libs/problems';
import { toBoolean } from '../../core/dto/transforms';
import { LANGUAGE_PAIR } from '../statement-language-pairs';

export const IMPORT_MODES = ['create', 'update'] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

/** Options travel in the query string: the multipart body carries only the package. */
export class PolygonImportQueryDto {
  /** Code of the problem to create or update. */
  @IsProblemCode()
  code!: string;
  /** `create` (default) makes a new problem; `update` replaces the data and statement of an existing one. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(IMPORT_MODES)
  mode: ImportMode = 'create';
  /** Slug of the organization a created problem belongs to: private to it, code with its prefix, charged to its quota; needs the rights of `POST /organizations/{slug}/problems` instead of `judge.add_problem`. Ignored by `update`. */
  @IsOptional() @IsString() organization?: string;
  /** Author user ids; repeat the parameter. */
  @IsOptional()
  @Transform(toArray)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  authors?: string[];
  /** Curator user ids; repeat the parameter. On create the caller is added. */
  @IsOptional()
  @Transform(toArray)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  curators?: string[];
  /** Problem group id. */
  @IsOptional() @LowercaseUuid() @IsUUID('7') groupId?: string;
  /** Problem type ids; repeat the parameter. */
  @IsOptional()
  @Transform(toArray)
  @LowercaseUuid()
  @IsUUID('7', { each: true })
  typeIds?: string[];
  /** Points the problem is worth, 800 to 3500. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(PROBLEM_LIMITS.points.min)
  @Max(PROBLEM_LIMITS.points.max)
  points?: number;
  /** Polygon language of the statement stored as the base statement. */
  @IsOptional() @IsString() @MaxLength(30) mainStatementLanguage?: string;
  /** Mapping `<polygon language>=<site language>` (`en` or `vi`) for translations, or `<polygon language>=skip` to leave a statement out; repeat the parameter. Every statement but the main one needs an entry. */
  @IsOptional()
  @Transform(toArray)
  @Matches(LANGUAGE_PAIR, { each: true })
  statementLanguages?: string[];
  /** Polygon language of the tutorial imported as the editorial. */
  @IsOptional() @IsString() @MaxLength(30) tutorialLanguage?: string;
  /** Skip batches worth zero points. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ignoreZeroPointBatches: boolean = false;
  /** Skip cases worth zero points. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  ignoreZeroPointCases: boolean = false;
  /** Append the package's main solution to the editorial. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  appendMainSolution: boolean = false;
  /** Import the package statement's tutorial as the editorial. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  importTutorial: boolean = true;
}

/** A UUIDv7, or the `polygon-sync-<problem id>-<package id>` id of a Polygon sync. */
const IMPORT_JOB_ID = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|${SYNC_JOB_ID.source}`,
);

export class ImportJobParamDto {
  /** Job id from the start response (a UUIDv7, or `polygon-sync-…` for a Polygon sync). */
  @Matches(IMPORT_JOB_ID) jobId!: string;
}

export class ImportJobsQueryDto {
  /** `1`: the caller's own jobs, the only list there is. */
  @Transform(toBoolean)
  @IsBoolean()
  @Equals(true)
  mine!: boolean;
}
