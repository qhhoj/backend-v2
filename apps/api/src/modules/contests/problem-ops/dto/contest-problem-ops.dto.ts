import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

/** The key stays unvalidated like `ContestKeyParamDto`; a malformed code is a 400. */
export class ContestProblemParamsDto {
  /** Key of the contest. */
  @IsString() key!: string;
  /** Code of a problem in the contest. */
  @Matches(PROBLEM_CODE_PATTERN) code!: string;
}

export class ContestProblemRejudgeDto {
  /** Also rejudge locked submissions. */
  @IsOptional() @IsBoolean() force?: boolean;
  /** Count what would be rejudged and change nothing. */
  @IsOptional() @IsBoolean() dryRun?: boolean;
}
