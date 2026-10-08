import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const MODERATION_STATES = ['hidden', 'scheduled'] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

/** The moderation board's lists: `hidden` (drafts) or `scheduled` (visible, publishing later). */
export class PostModerationQueryDto {
  @IsIn(MODERATION_STATES) state!: ModerationState;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}
