import { newId } from '@libs/database';
import {
  createPasswordResetToken,
  passwordResetTokenValid,
  readPasswordResetToken,
} from './password-reset-token';

const SECRET = 'a'.repeat(32);
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;
const owner = {
  id: newId(),
  password: 'hash-1',
  lastLogin: null as Date | null,
};
const parse = (token: string) => readPasswordResetToken(token)!;

describe('password reset token', () => {
  it('round-trips and is valid for its owner', () => {
    const token = createPasswordResetToken(owner, SECRET, NOW);
    const parsed = parse(token);
    expect(parsed.userId).toBe(owner.id);
    expect(passwordResetTokenValid(parsed, owner, SECRET, NOW + 1000)).toBe(
      true,
    );
  });

  it('is invalid under another secret, password or lastLogin', () => {
    const parsed = parse(createPasswordResetToken(owner, SECRET, NOW));
    expect(passwordResetTokenValid(parsed, owner, 'b'.repeat(32), NOW)).toBe(
      false,
    );
    expect(
      passwordResetTokenValid(
        parsed,
        { ...owner, password: 'hash-2' },
        SECRET,
        NOW,
      ),
    ).toBe(false);
    expect(
      passwordResetTokenValid(
        parsed,
        { ...owner, lastLogin: new Date(NOW) },
        SECRET,
        NOW,
      ),
    ).toBe(false);
  });

  it('expires after 3 days and rejects tokens issued in the future', () => {
    const parsed = parse(createPasswordResetToken(owner, SECRET, NOW));
    expect(passwordResetTokenValid(parsed, owner, SECRET, NOW + 3 * DAY)).toBe(
      true,
    );
    expect(
      passwordResetTokenValid(parsed, owner, SECRET, NOW + 3 * DAY + 2000),
    ).toBe(false);
    expect(passwordResetTokenValid(parsed, owner, SECRET, NOW - 10_000)).toBe(
      false,
    );
  });

  it('rejects malformed tokens when reading', () => {
    const valid = createPasswordResetToken(owner, SECRET, NOW);
    const nonV7 = createPasswordResetToken(
      { ...owner, id: '11111111-1111-4111-8111-111111111111' },
      SECRET,
      NOW,
    );
    for (const token of [
      '',
      'x',
      valid.slice(1),
      `${valid}A`,
      `${valid}=`,
      `${valid}!`,
      nonV7,
    ])
      expect(readPasswordResetToken(token)).toBeNull();
  });
});
