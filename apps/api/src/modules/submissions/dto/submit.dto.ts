import { JUDGE_NAME_PATTERN, MAX_SOURCE_LENGTH } from '@libs/database';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

export class SubmitDto {
  /** Language id; must be one of the problem's allowed languages. */
  @IsUUID('all') language!: string;
  @IsString() @Length(1, MAX_SOURCE_LENGTH) source!: string;
  /** Name of the judge to use (legacy `judge-id`); problem editors only. */
  @IsOptional() @IsString() @Matches(JUDGE_NAME_PATTERN) judgeId?: string;
}
