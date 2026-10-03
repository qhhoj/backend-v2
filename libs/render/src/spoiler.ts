import type MarkdownIt from 'markdown-it';

/** Legacy markdown2 `spoiler` extra: consecutive lines starting with `>!` become `<blockquote class="spoiler">`. */
export function spoilerRule(
  state: MarkdownIt.StateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  const lineStart = (line: number) => state.bMarks[line] + state.tShift[line];
  const marked = (line: number) =>
    state.sCount[line] < 4 && state.src.startsWith('>!', lineStart(line));
  if (!marked(startLine)) return false;
  if (silent) return true;
  const lines: string[] = [];
  let line = startLine;
  for (; line < endLine && marked(line); line++)
    lines.push(
      state.src
        .slice(lineStart(line) + 2, state.eMarks[line])
        .replace(/^ /, ''),
    );
  const open = state.push('spoiler_open', 'blockquote', 1);
  open.attrSet('class', 'spoiler');
  open.map = [startLine, line];
  state.md.block.parse(lines.join('\n'), state.md, state.env, state.tokens);
  state.push('spoiler_close', 'blockquote', -1);
  state.line = line;
  return true;
}
