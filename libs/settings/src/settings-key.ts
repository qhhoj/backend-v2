/** Provider token for the 32-byte encryption key; its own file so the querier and service do not import the module that imports them. */
export const SETTINGS_KEY = Symbol('SETTINGS_KEY');
