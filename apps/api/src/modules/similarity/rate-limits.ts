/** Run starts per user; a start that ends in a conflict or fails to queue is given back. A counted start enqueues a job that reads every submission of the scope. */
export const SIMILARITY_START_LIMIT = 10;
export const SIMILARITY_START_WINDOW_SECONDS = 60 * 60;
/** A run active this long is treated as abandoned (the worker deadline is 30 minutes, plus queue wait). */
export const SIMILARITY_STALE_AFTER_MS = 3 * 60 * 60 * 1000;
