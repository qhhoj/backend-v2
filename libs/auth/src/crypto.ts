import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** Constant-time string compare; false for non-strings. */
export const constantTimeEqual = (left: unknown, right: string): boolean => {
  if (typeof left !== 'string') return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
};
