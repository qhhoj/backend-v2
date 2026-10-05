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
import { MAX_TESTCASES_MASS } from './limits';

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
const FileName = () =>
  applyDecorators(IsString(), MaxLength(100), Matches(NO_NUL));

export class TestCaseDto {
  @IsIn(CASE_TYPES) type!: CaseType;
  @FileName() input = '';
  @FileName() output = '';
  @NullableCount() points: number | null = null;
  @IsBoolean() isPretest = false;
  @IsString() @MaxLength(1000) generatorArgs = '';
  /** Never `bridged`: a custom checker is problem-wide only. */
  @IsIn(CASE_CHECKERS) checker: CaseChecker = '';
  @JsonArgs() checkerArgs: JsonObject | null = null;
  @NullableCount() outputPrefix: number | null = null;
  @NullableCount() outputLimit: number | null = null;
}

/** The whole configuration at once (legacy form + formset); file names are set by the upload routes and kept as they are. */
export class PutProblemDataDto {
  @IsIn(CHECKERS) checker!: Checker;
  @JsonArgs() checkerArgs: JsonObject | null = null;
  @IsIn(GRADERS) grader!: Grader;
  @JsonArgs() graderArgs: JsonObject | null = null;
  @NullableCount() outputPrefix: number | null = null;
  @NullableCount() outputLimit: number | null = null;
  @IsBoolean() unicode = false;
  @IsBoolean() nobigmath = false;
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
  @IsString() code!: string;
  @IsIn(SOURCE_FILE_KINDS) kind!: SourceFileKind;
}
export class DataFileKindParamDto {
  @IsString() code!: string;
  @IsIn(DATA_FILE_KINDS) kind!: DataFileKind;
}
/** Unvalidated beyond length: an unsafe name is a 404, never a 400 (see `ProblemDataService.download`). */
export class DataFileNameParamDto {
  @IsString() code!: string;
  @IsString() @MaxLength(120) name!: string;
}
