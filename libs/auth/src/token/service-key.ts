import { randomBytes } from 'node:crypto';
import { sha256 } from '../crypto';

export const SERVICE_KEY_PREFIX = 'qhi_';
/** `qhi_` + 32 random bytes in base64url (43 characters). A user API token is 64 characters and has no prefix, so the two shapes never overlap. */
const SERVICE_KEY_PATTERN = /^qhi_[A-Za-z0-9_-]{43}$/;

export const isServiceKey = (value: string): boolean =>
  SERVICE_KEY_PATTERN.test(value);

/** The key is shown once; only its sha256 is stored (a high-entropy secret needs no slow hash, and the hash is the lookup key). */
export function generateServiceKey(): { key: string; hash: string } {
  const key = `${SERVICE_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, hash: sha256(key) };
}
