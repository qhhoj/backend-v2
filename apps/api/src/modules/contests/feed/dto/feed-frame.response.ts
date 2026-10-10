import { ApiProperty } from '@nestjs/swagger';
import { OPAQUE_JSON_OBJECT } from '@libs/common';
import { FEED_EVENT_TYPES } from '@libs/contests';
import type { FeedEventType } from '@libs/contests';

/** One NDJSON line of the feed (snapshot and stream), as `feedLineOf` builds it. `data` is the ICPC contest-API object of that type; its members belong to that API, so it is free-form here. */
export class FeedLineResponse {
  /** Kind of ICPC contest API object in data. */
  @ApiProperty({ enum: FEED_EVENT_TYPES }) type!: FeedEventType;
  /** Id of the object; null for objects without one. */
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty({ ...OPAQUE_JSON_OBJECT }) data!: Record<string, unknown>;
  /** Counter that orders the events of a feed. */
  token!: string;
}
