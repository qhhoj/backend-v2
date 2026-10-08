import { newId } from '@libs/database';
import {
  canPrepareUserData,
  isUserDataExpired,
  userDataPath,
  userDataTempPath,
} from './user-data';

const DAY = 86_400_000;

describe('user data paths', () => {
  it('names the zip after the user id inside the root', () => {
    const id = newId();
    expect(userDataPath('/srv/user-data', id)).toBe(`/srv/user-data/${id}.zip`);
    expect(userDataTempPath('/srv/user-data', id, 'run')).toBe(
      `/srv/user-data/${id}.zip.run.tmp`,
    );
  });

  it('refuses anything but a user id', () => {
    expect(() => userDataPath('/srv/user-data', '../etc/passwd')).toThrow();
  });
});

describe('canPrepareUserData', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('allows the first prepare and one per day while a zip is ready', () => {
    expect(
      canPrepareUserData({ preparedAt: null, hasFreshZip: true, now }),
    ).toBe(true);
    expect(
      canPrepareUserData({
        preparedAt: new Date(now.getTime() - DAY + 1000),
        hasFreshZip: true,
        now,
      }),
    ).toBe(false);
    expect(
      canPrepareUserData({
        preparedAt: new Date(now.getTime() - DAY - 1000),
        hasFreshZip: true,
        now,
      }),
    ).toBe(true);
  });

  it('allows a new prepare at once when no zip is ready', () => {
    expect(
      canPrepareUserData({
        preparedAt: new Date(now.getTime() - 1000),
        hasFreshZip: false,
        now,
      }),
    ).toBe(true);
  });
});

describe('isUserDataExpired', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  it('expires a zip seven days after it was written', () => {
    expect(
      isUserDataExpired(new Date(now.getTime() - 7 * DAY + 1000), now),
    ).toBe(false);
    expect(isUserDataExpired(new Date(now.getTime() - 7 * DAY), now)).toBe(
      true,
    );
  });
});
