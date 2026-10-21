import type { StatementLanguageChoice } from '@libs/database';

/** `english=en`: a Polygon statement language and the site language its translation is stored under, or `russian=skip` to leave that statement out. The import and the link options both take this form. */
export const LANGUAGE_PAIR = /^[a-z]+=(en|vi|skip)$/;

/** `['russian=skip']` → `{ russian: 'skip' }`, as the job and the link store it. */
export const languageMapOf = (
  pairs: string[],
): Record<string, StatementLanguageChoice> =>
  Object.fromEntries(
    pairs.map((pair) => pair.split('=') as [string, StatementLanguageChoice]),
  );

/** The stored map back in the request form, sorted by Polygon language. */
export const languagePairsOf = (
  map: Record<string, StatementLanguageChoice>,
): string[] =>
  Object.entries(map)
    .map(([language, choice]) => `${language}=${choice}`)
    .sort();
