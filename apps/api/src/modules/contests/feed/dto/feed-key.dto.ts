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

  /** Days until the key expires, 1 to 30. */
  @IsOptional() @IsInt() @Min(1) @Max(MAX_FEED_KEY_DAYS) expiresInDays?: number;
}

/** The only time the key is shown. */
export class MintedFeedKeyResponse {
  /** The Basic user name, always `feed`. */
  username!: string;
  /** The feed key, the Basic password. It is shown only once. */
  key!: string;
  /** Whether the feed is cut at the freeze until released, or live. */
  @ApiProperty({ enum: FEED_KEY_MODES, enumName: 'FeedKeyMode' })
  mode!: FeedKeyMode;
  /** When the key expires, ISO 8601. */
  expiresAt!: string;
}

export class FeedKeyStatusResponse {
  /** Whether a usable, unexpired and unrevoked key exists. */
  isActive!: boolean;
  /** Mode of the active key; null if none. */
  @ApiProperty({
    enum: FEED_KEY_MODES,
    enumName: 'FeedKeyMode',
    nullable: true,
  })
  mode!: FeedKeyMode | null;
  /** When the active key expires, ISO 8601; null if none. */
  expiresAt!: string | null;
  /**
   * When the feed was released to the resolver, ISO 8601; null if not
   * released.
   */
  releasedAt!: string | null;
  /** Username of the editor the key is bound to. */
  createdBy!: string | null;
}
