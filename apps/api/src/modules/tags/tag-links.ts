/** Legacy `OJ_PROBLEM_PRESET`: the external judges whose problem urls we can turn into a tag-problem code. */
const PRESETS: ReadonlyArray<{
  pattern: RegExp;
  code: (groups: string[]) => string;
  judge: string;
}> = [
  {
    pattern: /^https:\/\/codeforces\.com\/problemset\/problem\/(\w+)\/(\w+)$/,
    code: ([contest, index]) => `CF_${contest}_${index}`,
    judge: 'Codeforces',
  },
  {
    pattern: /^https:\/\/codeforces\.com\/contest\/(\w+)\/problem\/(\w+)$/,
    code: ([contest, index]) => `CF_${contest}_${index}`,
    judge: 'Codeforces',
  },
  {
    pattern: /^https:\/\/atcoder\.jp\/contests\/\w*\/tasks\/(\w+)$/,
    code: ([task]) => `AC_${task}`,
    judge: 'Atcoder',
  },
  {
    pattern: /^https:\/\/oj\.vnoi\.info\/problem\/(\w+)$/,
    code: ([problem]) => `VNOJ_${problem}`,
    judge: 'VNOJ',
  },
  {
    pattern: /^https:\/\/open\.kattis\.com\/problems\/(\w+)$/,
    code: ([problem]) => `KATTIS_${problem}`,
    judge: 'Kattis',
  },
  {
    pattern: /^https:\/\/codeforces\.com\/gym\/(\w+)\/problem\/(\w+)$/,
    code: ([contest, index]) => `CFGYM_${contest}_${index}`,
    judge: 'CodeforcesGym',
  },
];
export const TAG_JUDGES = [
  'Atcoder',
  'Codeforces',
  'CodeforcesGym',
  'Kattis',
  'VNOJ',
] as const;

export function parseProblemLink(
  link: string,
): { code: string; judge: string } | null {
  for (const preset of PRESETS) {
    const match = preset.pattern.exec(link);
    if (match)
      return { code: preset.code(match.slice(1)), judge: preset.judge };
  }
  return null;
}
