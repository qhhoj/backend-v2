import { createHmac } from 'node:crypto';
import { isSessionSecret, SESSION_SECRET_PROBLEM } from '@libs/common';
import { constantTimeEqual, sha256 } from '../crypto';

/** The session keys of one user, so a password change or a ban can end them all. */
export const userSessionsKey = (userId: string) => `user-sessions:${userId}`;
export const userEpochKey = (userId: string) => `session-epoch:${userId}`;

/**
 * Keys and stored values of sessions, both bound to `SESSION_SECRET`: the key is
 * `session:<HMAC(secret, sha256(cookie))>` and the value is `<mac>.<json>`, where the mac covers the key
 * and the JSON. Without the secret, writing Redis cannot produce a key a cookie maps to or a record
 * `open` accepts, and a record copied to another key no longer opens.
 */
export class SessionRecords {
  /** Refuses a short or missing secret, so a process that builds records without the `web` config part stops at boot. */
  constructor(private readonly secret: string) {
    if (!isSessionSecret(secret)) throw new Error(SESSION_SECRET_PROBLEM);
  }

  keyFor(cookieId: string): string {
    return `session:${this.hmac(sha256(cookieId))}`;
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
