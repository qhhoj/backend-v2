import { Matches } from 'class-validator';
import { CONTEST_KEY_PATTERN } from '@libs/database';

export class CloneContestDto {
  /**
   * Key of the new contest: lowercase letters, digits and underscores, at most
   * 32.
   */
  @Matches(CONTEST_KEY_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  key!: string;
}
