import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HEX_SHA256 } from '@libs/database';
import { userIdBytes, userIdFromBytes } from './user-id-bytes';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;

const hashSecret = (secret: Buffer, tokenSecret: string) =>
  createHmac('sha256', tokenSecret).update(secret).digest('hex');

export function generateApiToken(
  userId: string,
  tokenSecret: string,
): { token: string; hash: string } {
  const secret = randomBytes(32);
  return {
    token: Buffer.concat([userIdBytes(userId), secret]).toString('base64url'),
    hash: hashSecret(secret, tokenSecret),
  };
}

export function parseApiToken(
  token: string,
): { userId: string; secret: Buffer } | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  const userId = userIdFromBytes(raw);
  return userId === null ? null : { userId, secret: raw.subarray(16) };
}

export const apiTokenMatches = (
  secret: Buffer,
  storedHash: string | null,
  tokenSecret: string,
): boolean =>
  storedHash !== null &&
  HEX_SHA256.test(storedHash) &&
  timingSafeEqual(
    Buffer.from(hashSecret(secret, tokenSecret), 'hex'),
    Buffer.from(storedHash, 'hex'),
  );
