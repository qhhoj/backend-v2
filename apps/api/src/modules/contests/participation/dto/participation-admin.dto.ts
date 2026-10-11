import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';

export const ADDED_PARTICIPATION_KINDS = ['live', 'virtual'] as const;
export type AddedParticipationKind = (typeof ADDED_PARTICIPATION_KINDS)[number];

/** Legacy admin participation add form. */
export class AddParticipationDto {
  /** Username of the participant. */
  @IsString() @MaxLength(30) user!: string;
  /** `live` (one per user) or a new `virtual` run. */
  @ApiProperty({ enum: ADDED_PARTICIPATION_KINDS })
  @IsIn(ADDED_PARTICIPATION_KINDS)
  kind!: AddedParticipationKind;
  /** When the participation starts, ISO 8601; defaults to now while the contest runs, else to the contest start (live) or now (virtual). */
  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsTimestamp()
  realStart?: string;
}

/** Legacy admin participation change form. */
export class UpdateParticipationDto {
  /** New start, ISO 8601: moves a timed participant's window. */
  @ApiProperty({ type: String, format: 'date-time' })
  @IsTimestamp()
  realStart!: string;
}
