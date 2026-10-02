import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{64}$/;
const UUID_V7_HEX_PATTERN = /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

const hashSecret = (secret: Buffer, tokenSecret: string) =>
  createHmac('sha256', tokenSecret).update(secret).digest('hex');

export function generateApiToken(
  userId: string,
  tokenSecret: string,
): { token: string; hash: string } {
  const secret = randomBytes(32);
  return {
    token: Buffer.concat([
      Buffer.from(userId.replaceAll('-', ''), 'hex'),
      secret,
    ]).toString('base64url'),
    hash: hashSecret(secret, tokenSecret),
  };
}

export function parseApiToken(
  token: string,
): { userId: string; secret: Buffer } | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  const hex = raw.subarray(0, 16).toString('hex');
  if (!UUID_V7_HEX_PATTERN.test(hex)) return null;
  return {
    userId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    secret: raw.subarray(16),
  };
}

export const apiTokenMatches = (
  secret: Buffer,
  storedHash: string | null,
  tokenSecret: string,
): boolean =>
  storedHash !== null &&
  HASH_PATTERN.test(storedHash) &&
  timingSafeEqual(
    Buffer.from(hashSecret(secret, tokenSecret), 'hex'),
    Buffer.from(storedHash, 'hex'),
  );
