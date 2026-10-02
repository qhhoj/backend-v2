import fixtures from '../../../../test/fixtures/django.json';
import {
  base32Decode,
  base32Encode,
  generateScratchCodes,
  generateTotpSecret,
  matchTotp,
  otpauthUrl,
  timecodeAt,
  totpCode,
} from './totp';

describe('totp', () => {
  it.each(fixtures.totp)(
    'matches pyotp for timecode $timecode',
    ({ key, timecode, code }) => expect(totpCode(key, timecode)).toBe(code),
  );
  it('round-trips base32 and rejects invalid characters', () => {
    const bytes = Buffer.from('hello totp world!!!!');
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(() => base32Decode('ABC1')).toThrow();
  });
  it('generates 32-char secrets and 16-char scratch codes', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateScratchCodes()).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[A-Z2-7]{16}$/)]),
    );
    expect(generateScratchCodes()).toHaveLength(5);
  });
  it('accepts codes within one step, rejects replays and others', () => {
    const secret = fixtures.totp[0].key;
    const now = new Date('2026-10-02T00:00:00Z');
    const current = timecodeAt(now);
    expect(matchTotp(secret, totpCode(secret, current - 1), 0, now)).toBe(
      current - 1,
    );
    expect(matchTotp(secret, totpCode(secret, current + 1), 0, now)).toBe(
      current + 1,
    );
    expect(matchTotp(secret, totpCode(secret, current - 2), 0, now)).toBeNull();
    expect(
      matchTotp(secret, totpCode(secret, current), current, now),
    ).toBeNull();
    for (const code of ['', '12345', '1234567', 'abcdef'])
      expect(matchTotp(secret, code, 0, now)).toBeNull();
  });
  it('returns null for hostile codes instead of throwing', () => {
    const secret = fixtures.totp[0].key;
    for (const code of [
      undefined,
      null,
      123456,
      ['123456'],
      { length: 6 },
      '1'.repeat(100_000),
      '12345\n',
      '１２３４５６',
    ])
      expect(matchTotp(secret, code, 0)).toBeNull();
  });
  it('throws a clear error for a malformed stored secret', () => {
    expect(() => matchTotp('not base32!', '123456', 0)).toThrow(
      'Invalid base32 input',
    );
    expect(() => matchTotp('', '123456', 0)).toThrow('Invalid TOTP secret');
  });
  it('builds an otpauth url', () =>
    expect(otpauthUrl('ABC', 'An Đức')).toBe(
      'otpauth://totp/QHHOJ:An%20%C4%90%E1%BB%A9c?secret=ABC&issuer=QHHOJ',
    ));
});
