import { ApiProperty } from '@nestjs/swagger';

export class SiteResponse {
  /** Legacy misc config: free-form key/value text served to everyone, so it must never hold secrets. */
  config!: Record<string, string>;
  /** Official contest mode is on right now (the flag and its end time). The response is cached `private, max-age=60`, so the shell may show the banner up to a minute after the mode ends. */
  officialMode!: boolean;
  /** The ISO 8601 UTC instant the mode switches itself off, or `null` when the mode is off or has no end time. Same cache as `officialMode`. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  officialModeEndsAt!: string | null;
}
