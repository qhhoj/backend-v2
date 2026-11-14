import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const TAKEDOWN_REASON_MAX_LENGTH = 500;

export class TakedownShareDto {
  /** Why, shown to the owner in their list and kept in the audit log. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(TAKEDOWN_REASON_MAX_LENGTH)
  reason!: string;
}
