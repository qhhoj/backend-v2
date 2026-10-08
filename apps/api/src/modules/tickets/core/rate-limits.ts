/** Tickets filed per user (spec: 5 per 10 minutes); a write refused after the reservation gives its hit back. */
export const TICKET_LIMIT = 5;
export const TICKET_WINDOW_SECONDS = 10 * 60;
/** Messages per user (new; each fans out to SSE streams and Discord). */
export const TICKET_MESSAGE_LIMIT = 30;
