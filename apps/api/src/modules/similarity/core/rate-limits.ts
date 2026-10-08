/** Run starts per user; a start that ends in a conflict or fails to queue is given back. A counted start enqueues a job that reads every submission of the scope. */
export const SIMILARITY_START_LIMIT = 10;
export const SIMILARITY_START_WINDOW_SECONDS = 60 * 60;
