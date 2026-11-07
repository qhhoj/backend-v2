/** Package requests per user and problem (POST only: polling the GET is free). */
export const PACKAGE_LIMIT = 3;
/** Package requests per user over every problem: each build can read 512 MiB, so the per-problem limit alone lets 100 problems cost 300 builds an hour. */
export const PACKAGE_USER_LIMIT = 10;
export const PACKAGE_WINDOW_SECONDS = 60 * 60;
