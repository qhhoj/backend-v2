import { fakeSettings } from '@libs/settings/testing';
import {
  assertNotLockedByOfficialMode,
  isOfficialModeActive,
  officialModeEndsAt,
  officialModeLocks,
} from './official-mode';

const NOW = new Date('2026-10-10T12:00:00Z');
const settings = (flag: boolean, endsAt = '') =>
  fakeSettings({
    'contest.officialMode': flag,
    'contest.officialModeEndsAt': endsAt,
  });

describe('isOfficialModeActive', () => {
  it('stays on before the end time and is off from it on', () => {
    const endsAt = '2026-10-10T12:00:00.000Z';
    expect(
      isOfficialModeActive(
        settings(true, endsAt),
        new Date('2026-10-10T11:59:59.999Z'),
      ),
    ).toBe(true);
    expect(isOfficialModeActive(settings(true, endsAt), NOW)).toBe(false);
  });
  it('ignores an end time while the flag is off', () => {
    expect(
      isOfficialModeActive(settings(false, '2099-01-01T00:00:00.000Z'), NOW),
    ).toBe(false);
  });
});

describe('officialModeLocks', () => {
  it('locks everyone but superusers while the mode is active', () => {
    const on = settings(true);
    expect(officialModeLocks(on, null, NOW)).toBe(true);
    expect(officialModeLocks(on, { isSuperuser: false }, NOW)).toBe(true);
    expect(officialModeLocks(on, { isSuperuser: true }, NOW)).toBe(false);
  });
  it('locks nobody once the mode ended or is off', () => {
    expect(
      officialModeLocks(settings(true, '2026-10-10T11:00:00.000Z'), null, NOW),
    ).toBe(false);
    expect(officialModeLocks(settings(false), null, NOW)).toBe(false);
  });
});

describe('officialModeEndsAt', () => {
  it('gives the end instant only while the mode is active', () => {
    const endsAt = '2026-10-10T13:30:00.000Z';
    expect(officialModeEndsAt(settings(true, endsAt), NOW)).toBe(endsAt);
    expect(officialModeEndsAt(settings(false, endsAt), NOW)).toBeNull();
    expect(
      officialModeEndsAt(settings(true, '2026-10-10T11:00:00.000Z'), NOW),
    ).toBeNull();
  });
});

describe('assertNotLockedByOfficialMode', () => {
  it('throws the 403 locked_in_official_contest for a locked viewer only', () => {
    expect(() =>
      assertNotLockedByOfficialMode(
        settings(true),
        { isSuperuser: false },
        NOW,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'locked_in_official_contest',
        status: 403,
      }),
    );
    expect(() =>
      assertNotLockedByOfficialMode(settings(true), { isSuperuser: true }, NOW),
    ).not.toThrow();
    expect(() =>
      assertNotLockedByOfficialMode(
        settings(false),
        { isSuperuser: false },
        NOW,
      ),
    ).not.toThrow();
  });
});
