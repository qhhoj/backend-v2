import { IsOptional, Matches } from 'class-validator';
import { CONTEST_KEY_PATTERN } from '@libs/database';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';

export class CloneContestDto {
  /**
   * Key of the new contest: lowercase letters, digits and underscores, at most
   * 32.
   */
  @Matches(CONTEST_KEY_PATTERN, {
    message: 'Only lowercase letters, digits and underscores (1-32).',
  })
  key!: string;
  /**
   * Start of the copy, ISO 8601. The end and the registration window move by
   * the same amount; omitted: the source's times are kept.
   */
  @IsOptional() @IsTimestamp() startTime?: string;
}
