// The site look a user picks (accent, contrast, background): stored on the user, sent in the session and the profile.
/** The frontend's accents (frontend `src/theme/appearance.ts`, palette A), picker order; the first is the site's. */
export const APPEARANCE_ACCENTS = [
  'ultramarine',
  'teal',
  'plum',
  'terracotta',
  'graphite',
] as const;
export type AppearanceAccent = (typeof APPEARANCE_ACCENTS)[number];
/** The Clay and Glass accents (retired 2026-11-15) and the accent each one became: accepted from older clients and stored, answered and kept as the new id. */
export const LEGACY_APPEARANCE_ACCENTS = {
  clay: 'terracotta',
  orchid: 'plum',
  ocean: 'ultramarine',
  mint: 'teal',
  sunset: 'terracotta',
  gold: 'terracotta',
  mono: 'graphite',
  red: 'terracotta',
} as const satisfies Record<string, AppearanceAccent>;
export type LegacyAppearanceAccent = keyof typeof LEGACY_APPEARANCE_ACCENTS;
/** What a write may send: a current accent or a retired one. */
export const ACCEPTED_ACCENTS = [
  ...APPEARANCE_ACCENTS,
  ...Object.keys(LEGACY_APPEARANCE_ACCENTS),
];
/** Standard or the high-contrast palette; absent in a look means `standard`. */
export const APPEARANCE_CONTRASTS = ['standard', 'high'] as const;
export type AppearanceContrast = (typeof APPEARANCE_CONTRASTS)[number];
/** The frontend's page-background styles (frontend `src/theme/appearance.ts`); absent in a look means the default, `blueprint`. */
export const APPEARANCE_BACKGROUNDS = [
  'none',
  'paper',
  'grainy',
  'blueprint',
  'contour',
  'halftone',
  'dither',
  'stipple',
  'landscape',
] as const;
export type AppearanceBackground = (typeof APPEARANCE_BACKGROUNDS)[number];

export class AppearanceResponse {
  /** Accent preset. */
  accent!: AppearanceAccent;
  /** Contrast level; absent means `standard`. */
  contrast?: AppearanceContrast;
  /** Page background style; absent means the default (`blueprint`). */
  background?: AppearanceBackground;
}
