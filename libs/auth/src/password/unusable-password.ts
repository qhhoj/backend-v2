import { randomBytes } from 'node:crypto';

/** Django's marker: a stored hash that starts with it matches no password. */
const UNUSABLE_PREFIX = '!';

/** A hash no password matches (Django `set_unusable_password`); the random tail keeps two of them distinct. */
export const unusablePasswordHash = (): string =>
  `${UNUSABLE_PREFIX}${randomBytes(20).toString('hex')}`;

/** False for an account that can only sign in through a social link until it sets a password with the reset form. */
export const hasUsablePassword = (encoded: string): boolean =>
  !encoded.startsWith(UNUSABLE_PREFIX);
