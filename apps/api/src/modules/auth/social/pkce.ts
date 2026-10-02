import { createHash } from 'node:crypto';

/** PKCE S256 code challenge for a code verifier. */
export const challengeOf = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');
