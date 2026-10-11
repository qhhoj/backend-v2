/** Prepares per user per day (new; legacy had none beyond one per day while a zip is ready): a prepare whose export fails is not rate limited by the zip rule, so this bounds the worker time. A reservation is never given back. */
export const USER_DATA_PREPARE_LIMIT = 3;
export const USER_DATA_PREPARE_WINDOW_SECONDS = 86_400;
/** Staff credential changes (password sets and e-mail changes) per admin per hour, never given back: a stolen staff session cannot take over accounts in bulk. */
export const ADMIN_CREDENTIAL_LIMIT = 10;
export const ADMIN_CREDENTIAL_WINDOW_SECONDS = 3600;
