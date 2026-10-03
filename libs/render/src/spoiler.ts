import type MarkdownIt from 'markdown-it';

const MAX_SPOILER_DEPTH = 20;
const OPEN_TAG = /^\s*<blockquote\s+class\s*=\s*(["'])spoiler\1\s*>\s*$/;
const CLOSE_TAG = /^\s*<\/blockquote>\s*$/;

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

/** Legacy Polygon importer output: a `<blockquote class="spoiler">` line up to its matching `</blockquote>` line; an unclosed one is left to the HTML block rule. */
function htmlSpoiler(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  lineText: (line: number) => string,
): boolean {
  if (
    state.sCount[startLine] - state.blkIndent >= 4 ||
    !OPEN_TAG.test(lineText(startLine))
  )
    return false;
  let open = 1;
  for (let line = startLine + 1; line < endLine; line++) {
    const text = lineText(line);
    if (OPEN_TAG.test(text)) open++;
    else if (CLOSE_TAG.test(text) && --open === 0) {
      pushSpoiler(
        state,
        startLine,
        line + 1,
        state.getLines(startLine + 1, line, state.blkIndent, false),
      );
      return true;
    }
  }
  return false;
}

/** Legacy `spoiler` blocks: `>!` lines (markdown2 extra) and raw `<blockquote class="spoiler">` HTML; past 20 levels they stay plain text/HTML. */
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
  if (silent)
    return (
      state.sCount[startLine] - state.blkIndent < 4 &&
      (lineText(startLine).startsWith('>!') ||
        OPEN_TAG.test(lineText(startLine)))
    );
  return (
    markedSpoiler(state, startLine, endLine, lineText) ||
    htmlSpoiler(state, startLine, endLine, lineText)
  );
}
