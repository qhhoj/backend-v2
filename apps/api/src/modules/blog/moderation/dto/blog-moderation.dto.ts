import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const MODERATION_STATES = [
  'hidden',
  'scheduled',
  'organization',
  'any',
] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

/** The moderation board's lists: `hidden` (drafts), `scheduled` (visible, publishing later), `organization` (every organization post) or `any` (every post). */
export class PostModerationQueryDto {
  @IsIn(MODERATION_STATES) state!: ModerationState;

  /** Text the title contains (case-insensitive), or an author's exact username. */
  @IsOptional() @IsString() @MaxLength(100) search?: string;

  /** Slug of one organization: keeps only its posts. An unknown slug matches nothing. */
  @IsOptional() @IsString() @MaxLength(128) organization?: string;

  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}
