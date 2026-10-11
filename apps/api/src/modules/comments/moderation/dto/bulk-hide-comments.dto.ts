import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
} from 'class-validator';

export const BULK_HIDE_MAX = 50;

export class BulkHideCommentsDto {
  /** Ids of the comments, at most 50; duplicates count once. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_HIDE_MAX)
  @IsString({ each: true })
  ids!: string[];

  /** True to hide each comment with its replies, false to restore them. */
  @IsBoolean() hidden!: boolean;
}

export class BulkHideOutcomeResponse {
  /** Id of the comment. */
  id!: string;
  /** Null when the change was made; otherwise the error code that refused it (`not_found`, `conflict`). */
  code!: string | null;
}
