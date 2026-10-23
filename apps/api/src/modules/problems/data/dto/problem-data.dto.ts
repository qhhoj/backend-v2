import { applyDecorators } from '@nestjs/common';
import {
  CASE_CHECKERS,
  CASE_TYPES,
  CHECKERS,
  DATA_FILE_KINDS,
  GRADERS,
} from '@libs/database';
import type {
  CaseChecker,
  CaseType,
  Checker,
  DataFileKind,
  Grader,
  JsonObject,
} from '@libs/database';
import { JUDGE_MAX_OUTPUT_LIMIT } from '@libs/problems';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_TESTCASES_MASS } from '../../core/dto/limits';

const NO_NUL = /^[^\0]*$/;

/** `{}` and null both mean "no arguments"; storing one form keeps the round-trip explicit. */
const emptyObjectToNull = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !Object.keys(value).length
      ? null
      : value,
  );
const JsonArgs = () =>
  applyDecorators(IsOptional(), IsObject(), emptyObjectToNull());
/** `update()` runs no schema validators, so counts must be proven safe integers here. */
const NullableCount = () =>
  applyDecorators(IsOptional(), IsInt(), Min(0), Max(Number.MAX_SAFE_INTEGER));
/** judge-v2 refuses a larger `output_limit_length` at judge time. */
const OutputLimit = () =>
  applyDecorators(IsOptional(), IsInt(), Min(0), Max(JUDGE_MAX_OUTPUT_LIMIT));
const FileName = () =>
  applyDecorators(IsString(), MaxLength(100), Matches(NO_NUL));

export class TestCaseDto {
  /** `C` normal case, `S` start of a batch, `E` end of a batch. */
  @IsIn(CASE_TYPES) type!: CaseType;
  /** Input file name inside the archive. */
  @ApiPropertyOptional()
  @FileName()
  input: string = '';
  /** Output file name inside the archive. */
  @ApiPropertyOptional()
  @FileName()
  output: string = '';
  /** Points of the case or batch; null when unscored. */
  @ApiPropertyOptional()
  @NullableCount()
  points: number | null = null;
  /** Whether this case belongs to the pretests. */
  @ApiPropertyOptional()
  @IsBoolean()
  isPretest: boolean = false;
  /** Arguments passed to the uploaded generator, one per line, up to 1000 characters. */
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(1000)
  generatorArgs: string = '';
  /** Never `bridged`: a custom checker is problem-wide only. */
  @ApiPropertyOptional()
  @IsIn(CASE_CHECKERS)
  checker: CaseChecker = '';
  /** Arguments of the case checker; null for none. */
  @ApiPropertyOptional()
  @JsonArgs()
  checkerArgs: JsonObject | null = null;
  /** Leading output bytes kept for display (`output_prefix_length`); null for the default. */
  @ApiPropertyOptional()
  @NullableCount()
  outputPrefix: number | null = null;
  /** Largest output accepted, in bytes (`output_limit_length`), at most 64 MiB; null for the default. */
  @ApiPropertyOptional()
  @OutputLimit()
  outputLimit: number | null = null;
}

/** The whole configuration at once (legacy form + formset); file names are set by the upload routes and kept as they are. */
export class PutProblemDataDto {
  /** Problem-wide checker: `standard`, `bridged` (the uploaded custom checker, compiled beside the uploaded header if any), `floats`, `floatsabs`, `floatsrel`, `identical`, `linecount`, `rstripped`, `sorted`, `unordered`, `easy` or `linematches`. */
  @IsIn(CHECKERS) checker!: Checker;
  /** Arguments of the checker; null for none. floats*: `precision` (0-20), `error_mode`; identical: `pe_allowed`; rstripped: `filter_new_line`; sorted: `split_on` (`lines`/`whitespace`); linematches: `point_distribution`, `filler_lines_required`; bridged: `type` (`testlib`, `themis`, `default`), `treat_checker_points_as_percentage` (testlib). Others take none; anything else is 400. */
  @ApiPropertyOptional()
  @JsonArgs()
  checkerArgs: JsonObject | null = null;
  /** Grader: `standard`, `interactive`, `signature` or `output_only`. */
  @IsIn(GRADERS) grader!: Grader;
  /** Arguments of the grader; null for none. standard: `io_method` (`standard`/`file`), `io_input_file`, `io_output_file`; interactive: `treat_checker_points_as_percentage` (the interactor's points); signature: `allow_main`. Others take none; anything else is 400. */
  @ApiPropertyOptional()
  @JsonArgs()
  graderArgs: JsonObject | null = null;
  /** Leading output bytes kept for display (`output_prefix_length`); null for the default. */
  @ApiPropertyOptional()
  @NullableCount()
  outputPrefix: number | null = null;
  /** Largest output accepted, in bytes (`output_limit_length`), at most 64 MiB; null for the default. */
  @ApiPropertyOptional()
  @OutputLimit()
  outputLimit: number | null = null;
  /** Judge `unicode` flag: output is read as Unicode text. */
  @ApiPropertyOptional()
  @IsBoolean()
  unicode: boolean = false;
  /** Judge `nobigmath` flag: turns off big-number arithmetic in the checker. */
  @ApiPropertyOptional()
  @IsBoolean()
  nobigmath: boolean = false;
  /** Every test case, in judging order. */
  @IsArray()
  @ArrayMaxSize(MAX_TESTCASES_MASS)
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  cases!: TestCaseDto[];
}

export const SOURCE_FILE_KINDS = [
  'generator',
  'customChecker',
  'customGrader',
  'customHeader',
] as const;
export type SourceFileKind = (typeof SOURCE_FILE_KINDS)[number];

export class DataSourceKindParamDto {
  /** Problem code. */
  @IsString() code!: string;
  /** Which source file: `generator`, `customChecker`, `customGrader` or `customHeader`. */
  @IsIn(SOURCE_FILE_KINDS) kind!: SourceFileKind;
}
export class DataFileKindParamDto {
  /** Problem code. */
  @IsString() code!: string;
  /** Which data file: `archive`, `generator`, `customChecker`, `customGrader` or `customHeader`. */
  @IsIn(DATA_FILE_KINDS) kind!: DataFileKind;
}
/** Unvalidated beyond length (100 = Fastify's maxParamLength, so a longer name is a 414 before this runs): an unsafe name is a 404, never a 400 (see `ProblemDataService.download`). */
export class DataFileNameParamDto {
  /** Problem code. */
  @IsString() code!: string;
  /** File name as stored in the problem data directory. */
  @IsString() @MaxLength(100) name!: string;
}
