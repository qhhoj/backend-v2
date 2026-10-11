import type { Language } from '@libs/database';

type NamedLanguage = Pick<
  Language,
  '_id' | 'key' | 'name' | 'shortName' | 'commonName'
>;

/** A suggestion needs at least this score (0-100). */
const MIN_SCORE = 55;
const SCORE_EQUAL = 100;
const SCORE_CONTAINS = 75;
const SCORE_SHARED_MAX = 60;
/** A shorter name than this ("c") is inside almost every name, so it can only match by equality. */
const MIN_CONTAINED_LENGTH = 2;

/** Lower case, the compilers' spellings folded together, letters and digits only. */
export function normaliseLanguageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/gnu g\+\+|g\+\+|c\+\+/g, 'cpp')
    .replace(/python 3/g, 'python3')
    .replace(/pypy 3/g, 'pypy3')
    .replace(/[^a-z0-9]/g, '');
}

function similarity(first: string, second: string): number {
  if (!first || !second) return 0;
  if (first === second) return SCORE_EQUAL;
  const [shorter, longer] =
    first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length >= MIN_CONTAINED_LENGTH && longer.includes(shorter))
    return SCORE_CONTAINS;
  const firstChars = new Set(first);
  const secondChars = new Set(second);
  const shared = [...firstChars].filter((char) => secondChars.has(char));
  return (
    (SCORE_SHARED_MAX * shared.length) /
    Math.max(firstChars.size, secondChars.size)
  );
}

/** The best score of the language's names; a tie goes to the longer (more specific) name, so `cpp20` beats `cpp` for "G++20". */
function scoreOf(remote: string, language: NamedLanguage): Match {
  const names = [
    language.key,
    language.name,
    language.shortName ?? '',
    language.commonName,
  ].map(normaliseLanguageName);
  return names
    .map((name) => ({ score: similarity(remote, name), length: name.length }))
    .reduce((best, match) => (isBetter(match, best) ? match : best));
}

interface Match {
  score: number;
  length: number;
}

const isBetter = (match: Match, than: Match): boolean =>
  match.score > than.score ||
  (match.score === than.score && match.length > than.length);

/** The site language a remote OJ language most likely is (by name), or null when none is close enough. The first best one wins a tie. */
export function suggestLanguage(
  remoteName: string,
  siteLanguages: readonly NamedLanguage[],
): string | null {
  const remote = normaliseLanguageName(remoteName);
  let best: (Match & { id: string }) | null = null;
  for (const language of siteLanguages) {
    const match = scoreOf(remote, language);
    if (match.score >= MIN_SCORE && (!best || isBetter(match, best)))
      best = { ...match, id: language._id };
  }
  return best?.id ?? null;
}
