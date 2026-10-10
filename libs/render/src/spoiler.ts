import type MarkdownIt from 'markdown-it';
import { classifyFenceLines } from './fences';

const MAX_SPOILER_DEPTH = 20;
const OPEN_TAG = /^<blockquote\s+class\s*=\s*(["'])spoiler\1\s*>\s*$/;
const CLOSE_TAG = /^<\/blockquote>\s*$/;

interface SpoilerEnv {
  spoilerDepth?: number;
}

/** Parses `body` as Markdown inside a `<blockquote class="spoiler">`; the depth lives in `env` because the nested parse starts a fresh block level. */
function pushSpoiler(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  body: string,
): void {
  const env = state.env as SpoilerEnv;
  const open = state.push('spoiler_open', 'blockquote', 1);
  open.attrSet('class', 'spoiler');
  open.map = [startLine, endLine];
  env.spoilerDepth = (env.spoilerDepth ?? 0) + 1;
  try {
    state.md.block.parse(body, state.md, state.env, state.tokens);
  } finally {
    env.spoilerDepth--;
  }
  state.push('spoiler_close', 'blockquote', -1);
  state.line = endLine;
}

/** Consecutive lines starting with `>!`. */
function markedSpoiler(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  lineText: (line: number) => string,
): boolean {
  const marked = (line: number) =>
    state.sCount[line] - state.blkIndent < 4 && lineText(line).startsWith('>!');
  if (!marked(startLine)) return false;
  const lines: string[] = [];
  let line = startLine;
  for (; line < endLine && marked(line); line++)
    lines.push(lineText(line).slice(2).replace(/^ /, ''));
  pushSpoiler(state, startLine, line, lines.join('\n'));
  return true;
}

/** Legacy `spoiler` blocks: `>!` lines (markdown2 extra); past 20 levels they stay plain text. */
export function spoilerRule(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (((state.env as SpoilerEnv).spoilerDepth ?? 0) >= MAX_SPOILER_DEPTH)
    return false;
  const lineText = (line: number) =>
    state.src.slice(
      state.bMarks[line] + state.tShift[line],
      state.eMarks[line],
    );
  return silent
    ? state.sCount[startLine] - state.blkIndent < 4 &&
        lineText(startLine).startsWith('>!')
    : markedSpoiler(state, startLine, endLine, lineText);
}

/** Closing tag line → opening tag line of each legacy spoiler pair (column 0, outside code fences, at most 20 deep), paired with a stack in one pass. */
function matchHtmlSpoilers(lines: string[]): Map<number, number> {
  const openerOf = new Map<number, number>();
  const openLines: number[] = [];
  const fenceKinds = classifyFenceLines(lines);
  lines.forEach((text, line) => {
    if (fenceKinds[line] !== 'outside') return;
    if (OPEN_TAG.test(text)) openLines.push(line);
    else if (CLOSE_TAG.test(text) && openLines.length) {
      if (openLines.length <= MAX_SPOILER_DEPTH)
        openerOf.set(line, openLines[openLines.length - 1]);
      openLines.pop();
    }
  });
  return openerOf;
}

/** `line` inside `depth` nested spoilers; a blank line becomes bare `>!` markers so the spoiler continues. */
const spoilerLine = (line: string, depth: number) => {
  if (!depth) return line;
  return line.trim()
    ? '>! '.repeat(depth) + line
    : '>! '.repeat(depth).trimEnd();
};

/** Legacy Polygon importer output (`<blockquote class="spoiler">` … `</blockquote>` on their own column-0 lines) rewritten to `>!` lines so the content is parsed as Markdown. A pair is rewritten only where markdown-it starts a new block (document start, after a blank line or a rewritten tag line); otherwise, and when unmatched or indented, the tags stay raw HTML. */
export function rewriteHtmlSpoilers(text: string): string {
  const lines = text.split('\n');
  const openerOf = matchHtmlSpoilers(lines);
  const pairedOpens = new Set(openerOf.values());
  const rewrittenTags = new Set<number>();
  const startsBlock = (line: number) =>
    line === 0 || !lines[line - 1].trim() || rewrittenTags.has(line - 1);
  let depth = 0;
  const rewritten: string[] = [];
  lines.forEach((text, line) => {
    const opener = openerOf.get(line);
    if (pairedOpens.has(line) && startsBlock(line)) {
      rewrittenTags.add(line);
      depth++;
    } else if (opener !== undefined && rewrittenTags.has(opener)) {
      if (opener === line - 1) rewritten.push(spoilerLine('', depth));
      rewrittenTags.add(line);
      depth--;
      rewritten.push(spoilerLine('', depth));
    } else rewritten.push(spoilerLine(text, depth));
  });
  return rewritten.join('\n');
}
