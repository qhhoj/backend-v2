import type MarkdownIt from 'markdown-it';

const MAX_SPOILER_DEPTH = 20;
const OPEN_TAG = /^<blockquote\s+class\s*=\s*(["'])spoiler\1\s*>\s*$/;
const CLOSE_TAG = /^<\/blockquote>\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

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

/** Line numbers of the matched legacy spoiler open and close tags (column 0, outside code fences), paired with a stack in one pass. */
function matchHtmlSpoilers(lines: string[]): {
  opens: Set<number>;
  closes: Set<number>;
} {
  const opens = new Set<number>();
  const closes = new Set<number>();
  const openLines: number[] = [];
  let fence = '';
  lines.forEach((text, line) => {
    const marker = FENCE.exec(text)?.[1];
    if (fence) {
      if (marker?.startsWith(fence) && text.slice(marker.length).trim() === '')
        fence = '';
    } else if (marker) fence = marker;
    else if (OPEN_TAG.test(text)) openLines.push(line);
    else if (CLOSE_TAG.test(text) && openLines.length) {
      if (openLines.length <= MAX_SPOILER_DEPTH) {
        opens.add(openLines[openLines.length - 1]);
        closes.add(line);
      }
      openLines.pop();
    }
  });
  return { opens, closes };
}

/** `line` inside `depth` nested spoilers; a blank line becomes bare `>!` markers so the spoiler continues. */
const spoilerLine = (line: string, depth: number) =>
  line.trim() ? '>! '.repeat(depth) + line : '>! '.repeat(depth).trimEnd();

/** Legacy Polygon importer output (`<blockquote class="spoiler">` … `</blockquote>` on their own column-0 lines) rewritten to `>!` lines so the content is parsed as Markdown; unmatched or indented tags stay raw HTML. */
export function rewriteHtmlSpoilers(text: string): string {
  const lines = text.split('\n');
  const { opens, closes } = matchHtmlSpoilers(lines);
  let depth = 0;
  const rewritten: string[] = [];
  lines.forEach((line, index) => {
    if (opens.has(index)) depth++;
    else if (closes.has(index)) depth--;
    else rewritten.push(spoilerLine(line, depth));
  });
  return rewritten.join('\n');
}
