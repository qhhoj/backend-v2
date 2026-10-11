/** Comments per user (new; legacy had none); a write refused after the reservation (render limits) gives its hit back. */
export const COMMENT_LIMIT = 10;
export const COMMENT_WINDOW_SECONDS = 5 * 60;
/** Comment edits per user (new): every accepted edit stores a revision row with the old and new body. */
export const EDIT_LIMIT = 20;
export const EDIT_WINDOW_SECONDS = 5 * 60;
/** Markdown previews per user: generous, the composer previews as the user types (debounced). */
export const PREVIEW_LIMIT = 30;
export const PREVIEW_WINDOW_SECONDS = 60;
/** Reports per user (new). */
export const REPORT_LIMIT = 10;
export const REPORT_WINDOW_SECONDS = 60 * 60;
