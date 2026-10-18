import type MarkdownIt from 'markdown-it';

/** `#` then a label (`#C`, `#12`) that is not glued to a word on either side. */
const PROBLEM_REFERENCE = /^#([A-Za-z0-9]{1,8})(?![\w])/;
const WORD_CHAR = /\w/;

/** The class every `#C` anchor carries; one without an href is resolved by the reader's page from the problems that reader may see. */
export const PROBLEM_REFERENCE_CLASS = 'problem-ref';

/**
 * The `problemLinks` render option (a contest announcement's `#C`): which words name a problem label, and the href of the
 * labels whose problem codes may be stored in the HTML. A label without an href becomes a label-only anchor.
 */
export interface ProblemLinks {
  isLabel(label: string): boolean;
  hrefs: Readonly<Record<string, string>>;
}

const linksOf = (env: unknown): ProblemLinks | undefined =>
  (env as { problemLinks?: ProblemLinks }).problemLinks;

/** The `#C` reference `text` starts with: its length and href (null: label-only), or null when it names no label. */
export function problemReferenceAt(
  text: string,
  env: unknown,
): { length: number; href: string | null } | null {
  const links = linksOf(env);
  const match = links && PROBLEM_REFERENCE.exec(text);
  if (!links || !match || !links.isLabel(match[1])) return null;
  const href = Object.hasOwn(links.hrefs, match[1])
    ? links.hrefs[match[1]]
    : null;
  return { length: match[0].length, href };
}

/** `#C` names the contest's problem labelled C and becomes an anchor; a word that is no label, a code span and a link's own text stay as written. */
export function problemReferenceRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x23 || state.linkLevel > 0)
    return false;
  if (state.pos > 0 && WORD_CHAR.test(state.src[state.pos - 1])) return false;
  const reference = problemReferenceAt(
    state.src.slice(state.pos, state.posMax),
    state.env,
  );
  if (!reference) return false;
  if (!silent) {
    const token = state.push('problem_reference', 'a', 0);
    token.content = state.src.slice(state.pos, state.pos + reference.length);
    if (reference.href !== null) token.attrSet('href', reference.href);
  }
  state.pos += reference.length;
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
  const href = token.attrGet('href');
  const hrefAttribute =
    href === null ? '' : ` href="${escapeAttribute(String(href))}"`;
  return `<a class="${PROBLEM_REFERENCE_CLASS}"${hrefAttribute}>${token.content}</a>`;
};
