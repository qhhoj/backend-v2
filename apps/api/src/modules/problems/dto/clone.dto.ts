import { PROBLEM_CODE_PATTERN } from '@libs/database';
import { Matches } from 'class-validator';

export class CloneProblemDto {
  @Matches(PROBLEM_CODE_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  code!: string;
}
