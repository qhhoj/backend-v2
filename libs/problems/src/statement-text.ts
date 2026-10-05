/** Legacy DMOJ_PROBLEM_STATEMENT_DISALLOWED_CHARACTERS: typographic quotes, the minus sign and ligatures pasted from word processors. */
export const DISALLOWED_STATEMENT_CHARACTERS: readonly string[] = [
  '“',
  '”',
  '‘',
  '’',
  '−',
  'ﬀ',
  'ﬁ',
  'ﬂ',
  'ﬃ',
  'ﬄ',
];
/** Rendering cost is linear in the Markdown size. */
export const MAX_MARKDOWN_LENGTH = 200_000;

export const findDisallowedCharacter = (text: string): string | null =>
  DISALLOWED_STATEMENT_CHARACTERS.find((character) =>
    text.includes(character),
  ) ?? null;
