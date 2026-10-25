export const FAILURE_LIMIT = 10;
/** Login failures per account and network (IPv6 /48, IPv4 address) and window: one site or tunnel is handed a whole IPv6 /48, so its addresses share one budget per account; an IPv4 /24 may be a carrier's shared pool, so it does not. */
export const FAILURE_NETWORK_LIMIT = 30;
export const FAILURE_WINDOW_SECONDS = 15 * 60;
/** Login failures per address and window, across every username: a ceiling against spraying, high enough that a 60-student room behind one NAT, each with a few typos, never reaches it. */
export const FAILURE_IP_LIMIT = 300;
/** Correct passwords per account and window (login, and confirmation): each check is a full PBKDF2 hash. */
export const SUCCESS_ACCOUNT_LIMIT = 20;
/** Correct logins per address and window: high enough for a classroom behind one NAT signing in together. */
export const SUCCESS_IP_LIMIT = 300;
export const DAILY_FAILURE_LIMIT = 50;
export const DAILY_WINDOW_SECONDS = 24 * 60 * 60;
export const OAUTH_START_LIMIT = 30;
export const OAUTH_START_WINDOW_SECONDS = 10 * 60;
export const REGISTRATION_IP_LIMIT = 5;
export const REGISTRATION_WINDOW_SECONDS = 60 * 60;
export const PASSWORD_RESET_IP_LIMIT = 10;
export const PASSWORD_RESET_EMAIL_LIMIT = 3;
export const PASSWORD_RESET_WINDOW_SECONDS = 60 * 60;
export const USERNAME_CHECK_IP_LIMIT = 30;
export const USERNAME_CHECK_WINDOW_SECONDS = 10 * 60;
export const ACTIVATION_RESEND_IP_LIMIT = 10;
export const ACTIVATION_RESEND_EMAIL_LIMIT = 3;
export const ACTIVATION_RESEND_WINDOW_SECONDS = 60 * 60;
