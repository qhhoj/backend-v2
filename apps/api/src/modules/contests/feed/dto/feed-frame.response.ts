import { ApiProperty } from '@nestjs/swagger';
import { OPAQUE_JSON_OBJECT } from '@libs/common';
import { FEED_EVENT_TYPES } from '@libs/contests';
import type { FeedEventType } from '@libs/contests';

/** One NDJSON line of the feed, as `feedLineOf` builds it. `data` is the ICPC contest-API object of that type; its members belong to that API, so it is free-form here. */
export class FeedLineResponse {
  @ApiProperty({ enum: FEED_EVENT_TYPES }) type!: FeedEventType;
  @ApiProperty({ type: String, nullable: true }) id!: string | null;
  @ApiProperty({ ...OPAQUE_JSON_OBJECT }) data!: Record<string, unknown>;
  token!: string;
}

/** A frame of the documented stream: `event` repeats the line's `type`, `data` is the whole line. The wire format is NDJSON, not `text/event-stream`. */
export class FeedEventFrame {
  @ApiProperty({ enum: FEED_EVENT_TYPES }) event!: FeedEventType;
  data!: FeedLineResponse;
}
