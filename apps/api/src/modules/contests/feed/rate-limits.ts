/** Failed Basic attempts per client IP and contest; hits are counted before the check and a success gives its hit back, so a locked IP is refused even with the right key. */
export const FEED_FAIL_LIMIT = 5;
export const FEED_FAIL_WINDOW_SECONDS = 10 * 60;
/** Requests per key. */
export const FEED_KEY_LIMIT = 60;
export const FEED_KEY_WINDOW_SECONDS = 60;
/** Key mints per user and contest. */
export const FEED_MINT_LIMIT = 5;
export const FEED_MINT_WINDOW_SECONDS = 60 * 60;
