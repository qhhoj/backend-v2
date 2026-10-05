export const RENDER_PREVIEW_LIMIT = 60;
export const RENDER_PREVIEW_WINDOW_SECONDS = 60;
export const UPLOAD_LIMIT = 30;
export const UPLOAD_WINDOW_SECONDS = 60 * 60;
/** Per client IP; only enqueue attempts count, cached hits are free. */
export const PDF_RENDER_LIMIT = 30;
export const PDF_RENDER_WINDOW_SECONDS = 60;
/** Fresh render jobs per problem and language before clients get 503 instead of 202 (failed jobs are removed, so every failure shows up as a new job). */
export const PDF_JOB_RETRY_LIMIT = 5;
export const PDF_JOB_RETRY_WINDOW_SECONDS = 10 * 60;
