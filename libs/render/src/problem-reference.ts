import type MarkdownIt from 'markdown-it';

/** `#` then a label (`#C`, `#12`) that is not glued to a word on either side. */
const PROBLEM_REFERENCE = /^#([A-Za-z0-9]{1,8})(?![\w])/;
const WORD_CHAR = /\w/;

/** The `problemLinks` render option: problem label → href (a contest announcement's `#C`). */
export type ProblemLinks = Readonly<Record<string, string>>;

const linksOf = (env: unknown): ProblemLinks | undefined =>
  (env as { problemLinks?: ProblemLinks }).problemLinks;

/** The href of the `#C` reference `text` starts with, or null (no links given, or not a known label). */
export function problemReferenceAt(
  text: string,
  env: unknown,
): { length: number; href: string } | null {
  const links = linksOf(env);
  const match = links && PROBLEM_REFERENCE.exec(text);
  if (!links || !match || !Object.hasOwn(links, match[1])) return null;
  return { length: match[0].length, href: links[match[1]] };
}

/** `#C` names the contest's problem labelled C and becomes a link to it; an unknown label, a code span and a link's own text stay as written. */
export function problemReferenceRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x23 || state.linkLevel > 0)
    return false;
  const links = linksOf(state.env);
  if (!links) return false;
  if (state.pos > 0 && WORD_CHAR.test(state.src[state.pos - 1])) return false;
  const match = PROBLEM_REFERENCE.exec(
    state.src.slice(state.pos, state.posMax),
  );
  const href = match && Object.hasOwn(links, match[1]) ? links[match[1]] : null;
  if (!match || href === null) return false;
  if (!silent) {
    const token = state.push('problem_reference', 'a', 0);
    token.content = match[0];
    token.attrSet('href', href);
  }
  state.pos += match[0].length;
  return true;
}

const ATTRIBUTE_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeAttribute = (value: string): string =>
  value.replace(/[&<>"]/g, (char) => ATTRIBUTE_ESCAPES[char]);

/** The text is `#` and a label (letters and digits only); the href comes from the caller and is escaped. */
export const renderProblemReference = (
  tokens: MarkdownIt.Token[],
  index: number,
): string => {
  const token = tokens[index];
  return `<a href="${escapeAttribute(String(token.attrGet('href') ?? ''))}">${token.content}</a>`;
};
