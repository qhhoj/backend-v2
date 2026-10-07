/** Holds the admin-role cap check and write of one organization change. */
export const ORGANIZATION_ADMIN_LOCK_SECONDS = 10;

/** Join requests per user (new; legacy had none). A refused duplicate gives its hit back. */
export const JOIN_REQUEST_LIMIT = 5;
export const JOIN_REQUEST_WINDOW_SECONDS = 60 * 60;
/** Approvals of one organization run one at a time (slots); a parallel one is a 409 at once. */
export const APPROVAL_LOCK_SECONDS = 10;
