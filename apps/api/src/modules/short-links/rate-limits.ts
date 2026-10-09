/** New links per user per day (an idempotent hit on an existing automatic link gives its count back). */
export const CREATE_LIMIT = 20;
export const CREATE_WINDOW_SECONDS = 24 * 60 * 60;
/** Visits per address per minute. */
export const VISIT_LIMIT = 120;
export const VISIT_WINDOW_SECONDS = 60;
/** A generated code that collides is redrawn this many times in all. */
export const MAX_CODE_ATTEMPTS = 5;
