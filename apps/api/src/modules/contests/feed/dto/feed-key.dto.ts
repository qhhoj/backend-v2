import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FEED_KEY_MODES } from '@libs/database';
import type { FeedKeyMode } from '@libs/database';
import { MAX_FEED_KEY_DAYS } from '../feed-key';

export class MintFeedKeyDto {
  /** Default `frozen-until-release`; `live` is an explicit opt-in. */
  @ApiPropertyOptional({ enum: FEED_KEY_MODES, enumName: 'FeedKeyMode' })
  @IsOptional()
  @IsIn(FEED_KEY_MODES)
  mode?: FeedKeyMode;

  @IsOptional() @IsInt() @Min(1) @Max(MAX_FEED_KEY_DAYS) expiresInDays?: number;
}

/** The only time the key is shown. */
export class MintedFeedKeyResponse {
  /** The Basic user name, always `feed`. */
  username!: string;
  key!: string;
  @ApiProperty({ enum: FEED_KEY_MODES, enumName: 'FeedKeyMode' })
  mode!: FeedKeyMode;
  expiresAt!: string;
}

export class FeedKeyStatusResponse {
  isActive!: boolean;
  @ApiProperty({
    enum: FEED_KEY_MODES,
    enumName: 'FeedKeyMode',
    nullable: true,
  })
  mode!: FeedKeyMode | null;
  expiresAt!: string | null;
  releasedAt!: string | null;
  /** Username of the editor the key is bound to. */
  createdBy!: string | null;
}
