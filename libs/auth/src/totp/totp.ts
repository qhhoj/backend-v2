import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_TOLERANCE_STEPS = 1;

export function base32Encode(bytes: Buffer): string {
  let buffered = 0;
  let bitCount = 0;
  let output = '';
  for (const byte of bytes) {
    buffered = ((buffered << 8) | byte) & 0xffff;
    bitCount += 8;
    while (bitCount >= 5) {
      output += BASE32_ALPHABET[(buffered >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
  }
  return bitCount > 0
    ? output + BASE32_ALPHABET[(buffered << (5 - bitCount)) & 31]
    : output;
}

export function base32Decode(text: string): Buffer {
  let buffered = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 input');
    buffered = ((buffered << 5) | index) & 0xffff;
    bitCount += 5;
    if (bitCount >= 8) {
      bytes.push((buffered >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }
  return Buffer.from(bytes);
}

export const generateTotpSecret = (): string => base32Encode(randomBytes(20));
export const generateScratchCodes = (count = 5): string[] =>
  Array.from({ length: count }, () => base32Encode(randomBytes(10)));
export const timecodeAt = (date = new Date()): number =>
  Math.floor(date.getTime() / 1000 / TOTP_STEP_SECONDS);
export const otpauthUrl = (secret: string, username: string): string =>
  `otpauth://totp/QHHOJ:${encodeURIComponent(username)}?secret=${secret}&issuer=QHHOJ`;

export function totpCode(secret: string, timecode: number): string {
  const key = base32Decode(secret);
  if (key.length === 0) throw new Error('Invalid TOTP secret');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timecode));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000,
  ).padStart(6, '0');
}

/** Returns the matched timecode, or null. Timecodes at or below `lastTimecode` are replays. Never throws on hostile `code`. */
export function matchTotp(
  secret: string,
  code: unknown,
  lastTimecode: number,
  now = new Date(),
): number | null {
  // The 6-digit check must stay first: it guarantees equal-length operands for timingSafeEqual.
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = timecodeAt(now);
  for (
    let timecode = Math.max(lastTimecode + 1, current - TOTP_TOLERANCE_STEPS);
    timecode <= current + TOTP_TOLERANCE_STEPS;
    timecode++
  )
    if (
      timingSafeEqual(
        Buffer.from(totpCode(secret, timecode)),
        Buffer.from(code),
      )
    )
      return timecode;
  return null;
}
