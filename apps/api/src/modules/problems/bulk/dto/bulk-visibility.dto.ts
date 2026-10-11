import { PROBLEM_CODE_PATTERN } from '@libs/database';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MAX_CHANGE_MESSAGE_LENGTH } from '../../editing/dto/problem-edit.dto';

export const MAX_BULK_VISIBILITY_CODES = 100;

export class BulkVisibilityDto {
  /** Problem codes to change, 1 to 100, no repeats. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_VISIBILITY_CODES)
  @ArrayUnique()
  @Matches(PROBLEM_CODE_PATTERN, { each: true })
  codes!: string[];
  /** true publishes every listed problem, false makes it private. */
  @IsBoolean() isPublic!: boolean;
  /** When publishing, also set the publication date to now so the problems sort as new. Needs `judge.edit_all_problem`. Ignored when making private. */
  @IsOptional() @IsBoolean() setDateToNow?: boolean;
  /** Why, kept as the comment of each revision written. Up to 500 characters. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CHANGE_MESSAGE_LENGTH)
  changeMessage?: string;
}
