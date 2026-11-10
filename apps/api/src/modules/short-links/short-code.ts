import { randomInt } from 'node:crypto';
import { SHORT_CODE_ALPHABET, SHORT_CODE_LENGTH } from '@libs/database';

export interface ShortCodeTuning {
  /** Where new codes come from; specs queue codes to force collisions. */
  shortCodes: { next(): string };
}

/** Words staff may not choose as a code: site sections and words that read as an address. Generated codes cannot collide with them (each contains a letter the alphabet leaves out). */
export const RESERVED_SHORT_CODES: readonly string[] = [
  'admin',
  'api',
  'login',
  'logout',
  'register',
  'new',
  'static',
  'media',
  's',
];

export const isReservedShortCode = (code: string): boolean =>
  RESERVED_SHORT_CODES.includes(code);

/** `pick(limit)` returns an integer in `[0, limit)`; the default is cryptographically random. */
export function randomShortCode(
  pick: (limit: number) => number = (limit) => randomInt(limit),
): string {
  let code = '';
  for (let position = 0; position < SHORT_CODE_LENGTH; position += 1)
    code += SHORT_CODE_ALPHABET[pick(SHORT_CODE_ALPHABET.length)];
  return code;
}

export const SHORT_CODE_TUNING: ShortCodeTuning = {
  shortCodes: { next: () => randomShortCode() },
};
