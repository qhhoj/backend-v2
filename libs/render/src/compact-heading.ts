import type MarkdownIt from 'markdown-it';
import { problemReferenceAt } from './problem-reference';

/** 1–6 hashes directly followed by text: `##Input`. With a space after the hashes it is CommonMark's own heading. */
const COMPACT_HASHES = /^#{1,6}(?=[^\s#])/;
/** Closing hashes, which the old site dropped whether or not a space preceded them. */
const CLOSING_HASHES = /#+[ \t]*$/;

/** A legacy heading written without the space after its hashes (`##Input` is an h2, shifted to h4 like any heading); the old site's Markdown accepted it. Not when the line opens with a known `#C` problem reference. */
export function compactHeadingRule(
  state: MarkdownIt.StateBlock,
  startLine: number,
  _endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false;
  const line = state.src.slice(
    state.bMarks[startLine] + state.tShift[startLine],
    state.eMarks[startLine],
  );
  const hashes = COMPACT_HASHES.exec(line)?.[0];
  // An announcement line that opens with a problem reference (`#C: ...`) is text, not an h1.
  if (!hashes || problemReferenceAt(line, state.env)) return false;
  if (silent) return true;
  const tag = `h${hashes.length}`;
  state.line = startLine + 1;
  const open = state.push('heading_open', tag, 1);
  open.markup = hashes;
  open.map = [startLine, state.line];
  const inline = state.push('inline', '', 0);
  inline.content = line.slice(hashes.length).replace(CLOSING_HASHES, '').trim();
  inline.map = [startLine, state.line];
  inline.children = [];
  state.push('heading_close', tag, -1).markup = hashes;
  return true;
}
