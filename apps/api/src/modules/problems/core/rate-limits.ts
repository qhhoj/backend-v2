export const RENDER_PREVIEW_LIMIT = 60;
export const RENDER_PREVIEW_WINDOW_SECONDS = 60;
export const UPLOAD_LIMIT = 30;
export const UPLOAD_WINDOW_SECONDS = 60 * 60;
/** Per user; a Polygon import holds the single import worker for minutes. */
export const IMPORT_LIMIT = 10;
export const IMPORT_WINDOW_SECONDS = 60 * 60;
/** Per client IP; only enqueue attempts count, cached hits are free. */
export const PDF_RENDER_LIMIT = 30;
export const PDF_RENDER_WINDOW_SECONDS = 60;
/** A failed render job is kept this long: requests get 503 + Retry-After meanwhile, then it is cleared and rendering is retried. */
export const PDF_FAIL_WINDOW_SECONDS = 10 * 60;
/** Per user, every Polygon link check (preview or import); one that is not cached downloads a package from Polygon. */
export const POLYGON_LINK_LIMIT = 20;
export const POLYGON_LINK_WINDOW_SECONDS = 10 * 60;
/** Per user, every search or verify on the external judge: each is a request to the remote service. */
export const EXTERNAL_JUDGE_LOOKUP_LIMIT = 30;
export const EXTERNAL_JUDGE_LOOKUP_WINDOW_SECONDS = 60;
