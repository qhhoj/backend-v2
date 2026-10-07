import { Matches } from 'class-validator';
import { CONTEST_KEY_PATTERN } from '@libs/database';

export class CloneContestDto {
  @Matches(CONTEST_KEY_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  key!: string;
}
