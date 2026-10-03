import type MarkdownIt from 'markdown-it';

const USER_REFERENCE = /^\[(r?user):(\w+)\]/;

/** Legacy `[user:name]` / `[ruser:name]` references become plain profile links; the SPA decorates them by class. */
export function userReferenceRule(
  state: MarkdownIt.StateInline,
  silent: boolean,
): boolean {
  if (state.src.charCodeAt(state.pos) !== 0x5b) return false;
  const match = USER_REFERENCE.exec(state.src.slice(state.pos, state.posMax));
  if (!match) return false;
  if (!silent) {
    const token = state.push('user_reference', 'a', 0);
    token.content = match[2];
    token.attrSet(
      'class',
      match[1] === 'ruser' ? 'user-reference user-rating' : 'user-reference',
    );
  }
  state.pos += match[0].length;
  return true;
}

export const renderUserReference = (
  tokens: MarkdownIt.Token[],
  index: number,
): string => {
  const name = tokens[index].content;
  return `<a class="${tokens[index].attrGet('class') ?? ''}" href="/user/${name}">${name}</a>`;
};
