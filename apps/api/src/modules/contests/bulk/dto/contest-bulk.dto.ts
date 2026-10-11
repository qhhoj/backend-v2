import { CONTEST_KEY_PATTERN, CONTEST_TAG_PATTERN } from '@libs/database';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  Matches,
} from 'class-validator';

export const MAX_BULK_CONTEST_KEYS = 100;

class ContestKeysDto {
  /** Contest keys to change, 1 to 100, no repeats. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CONTEST_KEYS)
  @ArrayUnique()
  @Matches(CONTEST_KEY_PATTERN, { each: true })
  keys!: string[];
}

export class BulkContestVisibilityDto extends ContestKeysDto {
  /** true shows every listed contest, false hides it. */
  @IsBoolean() isVisible!: boolean;
}

export class BulkContestTagDto extends ContestKeysDto {
  /** The tag slug to add or remove. */
  @Matches(CONTEST_TAG_PATTERN) tag!: string;
  /** true adds the tag to every listed contest, false removes it. */
  @IsBoolean() assigned!: boolean;
}
