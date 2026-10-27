/** Django's marker: a stored hash that starts with it matches no password. */
const UNUSABLE_PREFIX = '!';

/** False for an account that can only sign in through a social link until it sets a password with the reset form. */
export const hasUsablePassword = (encoded: string): boolean =>
  !encoded.startsWith(UNUSABLE_PREFIX);
