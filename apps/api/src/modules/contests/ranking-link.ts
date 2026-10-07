import { randomInt } from 'node:crypto';
import type { ContestPublicRankingLink } from '@libs/database';

const TOKEN_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 18;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Legacy `generate_token`: 18 × [A-Za-z0-9] (≈ 107 bits), from the CSPRNG. */
export const generateRankingToken = (): string =>
  Array.from(
    { length: TOKEN_LENGTH },
    () => TOKEN_ALPHABET[randomInt(TOKEN_ALPHABET.length)],
  ).join('');

export type LinkExpirySettings = Pick<
  ContestPublicRankingLink,
  'expiryMode' | 'expiryAmount' | 'expiresAt'
>;

/** Legacy `compute_expires_at`: minutes and days count from the last regeneration. */
export function linkExpiry(
  { expiryMode, expiryAmount, expiresAt }: LinkExpirySettings,
  regeneratedAt: Date,
): Date | null {
  if (expiryMode === 'A') return expiresAt;
  if (expiryMode === 'U' || expiryAmount === null) return null;
  return new Date(
    regeneratedAt.getTime() +
      expiryAmount * (expiryMode === 'M' ? MINUTE_MS : DAY_MS),
  );
}

/** Legacy `is_valid`. */
export const isLinkValid = (
  link: Pick<ContestPublicRankingLink, 'status' | 'expiresAt'>,
  now: Date,
): boolean =>
  link.status === 'public' &&
  (link.expiresAt === null || now <= link.expiresAt);
