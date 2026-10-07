/** Legacy `judge/tasks/webhook.py` event names, also the keys of `DISCORD_WEBHOOK_URLS`; the ticket events are sent from 5c. */
export const DISCORD_EVENTS = [
  'on_new_comment',
  'on_new_blogpost',
  'on_new_problem',
  'on_new_suggested_problem',
  'on_new_ticket',
  'on_new_ticket_message',
] as const;
export type DiscordEvent = (typeof DISCORD_EVENTS)[number];

/** Legacy `get_webhook_url`: the event's URL, else `default`, else none (no-op). */
export const discordWebhookUrl = (
  urls: Readonly<Record<string, string>>,
  event: DiscordEvent,
): string | null => urls[event] ?? urls.default ?? null;

export interface DiscordMessage {
  title: string;
  description: string;
  author: { name: string; url: string } | null;
}

/** Legacy embed colour `03b2f8`. */
export const DISCORD_EMBED_COLOR = 0x03b2f8;

/** Legacy `send_webhook`: one embed; no avatar (it would need the author's email hash). */
export const discordPayload = (message: DiscordMessage) => ({
  embeds: [
    {
      title: message.title,
      description: message.description,
      color: DISCORD_EMBED_COLOR,
      ...(message.author ? { author: message.author } : {}),
    },
  ],
});

/** First `length` code points (legacy Python `text[:length]`). */
export const excerpt = (text: string, length: number): string =>
  Array.from(text).slice(0, length).join('');
