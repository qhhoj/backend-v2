import { createHmac } from 'node:crypto';
import { constantTimeEqual, sha256 } from '../crypto';

export const SESSION_KEY_PREFIX = 'session:';
/** The session keys of one user, so a password change or a ban can end them all. */
export const userSessionsKey = (userId: string) => `user-sessions:${userId}`;

/**
 * Keys and stored values of sessions, both bound to `SESSION_SECRET`: the key is
 * `session:<HMAC(secret, sha256(cookie))>` and the value is `<mac>.<json>`, where the mac covers the key
 * and the JSON. Without the secret, writing Redis cannot produce a key a cookie maps to or a record
 * `open` accepts, and a record copied to another key no longer opens.
 */
export class SessionRecords {
  /** Throws on a secret under 32 bytes, so the api refuses to boot without one. */
  constructor(private readonly secret: string) {
    if (Buffer.byteLength(secret) < 32)
      throw new Error('SESSION_SECRET must be at least 32 bytes');
  }

  keyFor(cookieId: string): string {
    return this.keyForDigest(sha256(cookieId));
  }

  /** `digest` is the sha256 hex of the cookie, the form keys had before they were bound to the secret. */
  keyForDigest(digest: string): string {
    return `${SESSION_KEY_PREFIX}${this.hmac(digest)}`;
  }

  seal(key: string, json: string): string {
    return `${this.recordMac(key, json)}.${json}`;
  }

  /** The JSON of a record sealed for `key`; null when it was not, or is malformed. */
  open(key: string, stored: string): string | null {
    const dot = stored.indexOf('.');
    if (dot < 0) return null;
    const json = stored.slice(dot + 1);
    return constantTimeEqual(stored.slice(0, dot), this.recordMac(key, json))
      ? json
      : null;
  }

  private recordMac(key: string, json: string): string {
    return this.hmac(`record\n${key}\n${json}`, 'base64url');
  }

  private hmac(message: string, encoding: 'hex' | 'base64url' = 'hex') {
    return createHmac('sha256', this.secret).update(message).digest(encoding);
  }
}
