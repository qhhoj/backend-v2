/** Holds the admin-role cap check and write of one organization change. */
export const ORGANIZATION_ADMIN_LOCK_SECONDS = 10;

/** Join requests per user (new; legacy had none). A refused duplicate gives its hit back. */
export const JOIN_REQUEST_LIMIT = 5;
export const JOIN_REQUEST_WINDOW_SECONDS = 60 * 60;
/** Member additions of one organization (approvals, joins, signups) run one at a time against `slots`; a parallel approval is a 409 at once. */
export const MEMBER_SLOTS_LOCK_SECONDS = 10;
/** A join or signup waits for the lock this long: each holder keeps it for one count and one write. */
export const MEMBER_SLOTS_WAIT_SECONDS = 5;
