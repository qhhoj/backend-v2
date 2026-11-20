import type { User } from '@libs/database';
import { LEGACY_APPEARANCE_ACCENTS } from './appearance';
import type { AppearanceResponse } from './appearance.response';

/** The Clay and Glass theme ids (retired 2026-11-15) and what each became; the SPA maps them the same way. */
const LEGACY_SITE_THEMES: Readonly<Record<string, string>> = {
  'clay-light': 'light',
  'glass-light': 'light',
  'clay-dark': 'dark',
  'glass-dark': 'dark',
  'glass-auto': 'auto',
};
const LEGACY_ACCENTS: Readonly<Record<string, string>> =
  LEGACY_APPEARANCE_ACCENTS;

/** A stored `siteTheme`, a retired id answered as its successor. */
export const currentSiteTheme = (siteTheme: string): string =>
  Object.hasOwn(LEGACY_SITE_THEMES, siteTheme)
    ? LEGACY_SITE_THEMES[siteTheme]
    : siteTheme;

/**
 * A look in the current shape: a retired accent becomes its successor, the Glass levels are dropped, and absent keys
 * stay absent. Used on write (what is stored) and on read (looks stored before palette A). Every value was checked by
 * `AppearanceDto` when it was written.
 */
export function currentAppearance(
  look: User['appearance'],
): AppearanceResponse | null {
  if (!look) return null;
  const { accent, contrast, background } = look;
  const current = {
    accent: Object.hasOwn(LEGACY_ACCENTS, accent)
      ? LEGACY_ACCENTS[accent]
      : accent,
    contrast,
    background,
  };
  return Object.fromEntries(
    Object.entries(current).filter(([, value]) => value !== undefined),
  ) as unknown as AppearanceResponse;
}
