import { AppError } from '@libs/common';
import type { SettingValue } from '@libs/settings';

type OfficialModeKey = 'contest.officialMode' | 'contest.officialModeEndsAt';

/** What the helpers read; `SettingsService` and the unit-test `FakeSettings` both fit. */
export interface OfficialModeSettings {
  get<Key extends OfficialModeKey>(key: Key): SettingValue<Key>;
}

/**
 * Official contest mode is on while the flag is set and its end time, if any, has not come. This file is the only reader of the two settings (a structural spec enforces it): a site that forgot to switch the mode off unlocks itself at the end time, and no call site can forget to ask.
 */
export function isOfficialModeActive(
  settings: OfficialModeSettings,
  now: Date = new Date(),
): boolean {
  if (!settings.get('contest.officialMode')) return false;
  const endsAt = settings.get('contest.officialModeEndsAt');
  return endsAt === '' || now.getTime() < new Date(endsAt).getTime();
}

/** The instant the shell counts down to: the stored end time while the mode is active and one is set, else `null`. It reads through `isOfficialModeActive`, so a past end time is `null`, never a stale instant. */
export function officialModeEndsAt(
  settings: OfficialModeSettings,
  now: Date = new Date(),
): string | null {
  if (!isOfficialModeActive(settings, now)) return null;
  return settings.get('contest.officialModeEndsAt') || null;
}

/** Public text (about, blog, comments), identity (name, badge, organization order) and organization membership are locked for everyone but superusers while the mode is active. Tickets stay open. */
export function officialModeLocks(
  settings: OfficialModeSettings,
  viewer: { isSuperuser: boolean } | null,
  now: Date = new Date(),
): boolean {
  return isOfficialModeActive(settings, now) && !viewer?.isSuperuser;
}

/** The refusal of the locks added by feature 15 (the older locks keep their own `forbidden` answers). */
export function assertNotLockedByOfficialMode(
  settings: OfficialModeSettings,
  viewer: { isSuperuser: boolean },
  now: Date = new Date(),
): void {
  if (!officialModeLocks(settings, viewer, now)) return;
  const message = 'This is locked during the official contest';
  throw new AppError(
    'locked_in_official_contest',
    403,
    message,
    undefined,
    undefined,
    {
      issues: [
        { field: 'officialMode', code: 'locked_in_official_contest', message },
      ],
    },
  );
}
