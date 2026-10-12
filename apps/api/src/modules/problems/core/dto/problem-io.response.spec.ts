import { ProblemIoResponse } from './problem-io.response';

const STDIO = { mode: 'stdio', inputFile: null, outputFile: null };

describe('ProblemIoResponse.from', () => {
  it('reports file names for the standard grader in file mode', () => {
    expect(
      ProblemIoResponse.from({
        grader: 'standard',
        graderArgs: {
          io_method: 'file',
          io_input_file: 'BAI.INP',
          io_output_file: 'BAI.OUT',
        },
      }),
    ).toEqual({ mode: 'file', inputFile: 'BAI.INP', outputFile: 'BAI.OUT' });
  });

  it.each([
    ['no data', null],
    ['no args', { grader: 'standard', graderArgs: null }],
    [
      'explicit standard io',
      { grader: 'standard', graderArgs: { io_method: 'standard' } },
    ],
    [
      'a missing file name (init.yml would reject it)',
      {
        grader: 'standard',
        graderArgs: { io_method: 'file', io_input_file: 'A.INP' },
      },
    ],
    [
      'file args left on a non-standard grader',
      {
        grader: 'interactive',
        graderArgs: {
          io_method: 'file',
          io_input_file: 'A.INP',
          io_output_file: 'A.OUT',
        },
      },
    ],
  ] as const)('falls back to stdin/stdout for %s', (_name, source) => {
    expect(ProblemIoResponse.from(source as never)).toEqual(STDIO);
  });
});
