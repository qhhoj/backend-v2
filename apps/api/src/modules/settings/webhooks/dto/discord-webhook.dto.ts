import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUrl, MaxLength } from 'class-validator';
import { DISCORD_EVENTS } from '@libs/community';
import type { DiscordEvent } from '@libs/community';

/** `default` (used by every event without its own URL) and each event. */
export const WEBHOOK_SLOTS = ['default', ...DISCORD_EVENTS] as const;
export type WebhookSlot = (typeof WEBHOOK_SLOTS)[number];

export class WebhookSlotParamDto {
  /** `default` or an event name. */
  @ApiProperty({ enum: WEBHOOK_SLOTS, enumName: 'DiscordWebhookSlot' })
  @IsIn(WEBHOOK_SLOTS)
  event!: WebhookSlot;
}

export class WebhookEventParamDto {
  /** An event name. */
  @ApiProperty({ enum: DISCORD_EVENTS, enumName: 'DiscordEvent' })
  @IsIn(DISCORD_EVENTS)
  event!: DiscordEvent;
}

export class SetWebhookDto {
  /** The Discord webhook URL (https). */
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(500)
  url!: string;
}

export class DiscordWebhookResponse {
  /** `default` or an event name. */
  @ApiProperty({ enum: WEBHOOK_SLOTS, enumName: 'DiscordWebhookSlot' })
  event!: WebhookSlot;
  /** The URL's host and its last 4 characters (`discord.com/…a1b2`); null when this slot has no URL of its own. */
  target!: string | null;
  /** The event has no URL of its own and is sent to the `default` one; false for `default` itself and for unsent events. */
  usesDefault!: boolean;
}
