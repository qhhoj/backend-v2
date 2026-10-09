import { ApiProperty } from '@nestjs/swagger';
import { OPAQUE_JSON_OBJECT } from '@libs/common';
import { FEED_EVENT_TYPES } from '@libs/contests';
import type { FeedEventType } from '@libs/contests';

/** One NDJSON line of the feed (snapshot and stream), as `feedLineOf` builds it. `data` is the ICPC contest-API object of that type; its members belong to that API, so it is free-form here. */
export class FeedLineResponse {
  @ApiProperty({ enum: FEED_EVENT_TYPES }) type!: FeedEventType;
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty({ ...OPAQUE_JSON_OBJECT }) data!: Record<string, unknown>;
  token!: string;
}
