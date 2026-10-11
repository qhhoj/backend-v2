import {
  canPrepareUserData,
  isUserDataExpired,
  userDataPath,
} from './user-data';

const DAY = 86_400_000;
const now = new Date('2026-10-07T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('user data', () => {
  it('refuses anything but a user id, so a path never leaves the root', () => {
    expect(() => userDataPath('/srv/user-data', '../etc/passwd')).toThrow();
  });

  it.each([
    [null, true, true],
    [ago(DAY - 1000), true, false],
    [ago(DAY + 1000), true, true],
    [ago(1000), false, true],
  ])(
    'prepare at %p with a fresh zip %p is allowed: %p',
    (preparedAt, hasFreshZip, allowed) =>
      expect(canPrepareUserData({ preparedAt, hasFreshZip, now })).toBe(
        allowed,
      ),
  );

  it('expires a zip exactly seven days after it was written', () => {
    expect(isUserDataExpired(ago(7 * DAY - 1000), now)).toBe(false);
    expect(isUserDataExpired(ago(7 * DAY), now)).toBe(true);
  });
});
