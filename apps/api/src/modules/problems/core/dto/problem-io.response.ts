import type { ProblemData } from '@libs/database';

export const IO_MODES = ['stdio', 'file'] as const;
export type IoMode = (typeof IO_MODES)[number];

/** The grading config a statement-side reader may see: how a solution reads and writes, never checker or tests. */
export type GradingIoSource = Pick<ProblemData, 'grader' | 'graderArgs'>;

/** Where a solution reads and writes. File names are set only in `file` mode. */
export class ProblemIoResponse {
  mode!: IoMode;
  inputFile!: string | null;
  outputFile!: string | null;

  /** Mirrors the init.yml rule: only the standard grader with `io_method: file` and both names set is file I/O. */
  static from(source: GradingIoSource | null): ProblemIoResponse {
    const args = source?.grader === 'standard' ? source.graderArgs : null;
    const input = args?.io_input_file;
    const output = args?.io_output_file;
    if (
      args?.io_method === 'file' &&
      typeof input === 'string' &&
      typeof output === 'string' &&
      input &&
      output
    )
      return { mode: 'file', inputFile: input, outputFile: output };
    return { mode: 'stdio', inputFile: null, outputFile: null };
  }
}
