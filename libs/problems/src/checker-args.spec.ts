import { checkerArgsProblem, graderArgsProblem } from './checker-args';

describe('checkerArgsProblem', () => {
  it('accepts what each checker reads, and no arguments at all', () => {
    expect(checkerArgsProblem('floats', { precision: 6 })).toBeNull();
    expect(
      checkerArgsProblem('floatsabs', { precision: 0, error_mode: 'relative' }),
    ).toBeNull();
    expect(checkerArgsProblem('sorted', { split_on: 'whitespace' })).toBeNull();
    expect(
      checkerArgsProblem('linematches', {
        point_distribution: [0, 2, 1],
        filler_lines_required: false,
      }),
    ).toBeNull();
    expect(checkerArgsProblem('standard', null)).toBeNull();
  });

  it('refuses an argument the checker does not read', () => {
    expect(checkerArgsProblem('standard', { precision: 6 })).toMatch(
      /does not take the argument "precision"/,
    );
    expect(checkerArgsProblem('identical', { precison: true })).toMatch(
      /precison/,
    );
  });

  it('refuses a precision that is not a whole number from 0 to 20', () => {
    for (const precision of [-1, 21, 2.5, '6'])
      expect(checkerArgsProblem('floats', { precision })).toMatch(/precision/);
  });

  it('refuses a line weighting the judge cannot score', () => {
    for (const point_distribution of [[], [0, 0], [1, -1], [1.5], 'x'])
      expect(checkerArgsProblem('linematches', { point_distribution })).toMatch(
        /point_distribution/,
      );
  });

  it('ignores the files and language of a custom checker, which the upload sets', () => {
    expect(
      checkerArgsProblem('bridged', {
        files: 'old.cpp',
        lang: 'CPP17',
        type: 'themis',
      }),
    ).toBeNull();
  });

  it('refuses custom checker kinds the judge does not grade', () => {
    for (const type of ['cms', 'coci', 'peg', 'nope'])
      expect(checkerArgsProblem('bridged', { type })).toMatch(/"type"/);
  });

  it('lets only a testlib checker read its points as a percentage', () => {
    const percent = { treat_checker_points_as_percentage: true };
    expect(checkerArgsProblem('bridged', percent)).toBeNull();
    expect(
      checkerArgsProblem('bridged', { ...percent, type: 'testlib' }),
    ).toBeNull();
    expect(
      checkerArgsProblem('bridged', { ...percent, type: 'themis' }),
    ).toMatch(/percentage/);
  });
});

describe('graderArgsProblem', () => {
  it('accepts file I/O on the standard grader and allow_main on the signature grader', () => {
    expect(
      graderArgsProblem('standard', {
        io_method: 'file',
        io_input_file: 'sum.inp',
        io_output_file: 'sum.out',
      }),
    ).toBeNull();
    expect(graderArgsProblem('signature', { allow_main: true })).toBeNull();
  });

  it('refuses file I/O on a grader that ignores it, and a bad method', () => {
    expect(graderArgsProblem('interactive', { io_method: 'file' })).toMatch(
      /does not take/,
    );
    expect(graderArgsProblem('standard', { io_method: 'pipe' })).toMatch(
      /io_method/,
    );
    expect(graderArgsProblem('standard', { io_input_file: 3 })).toMatch(
      /io_input_file/,
    );
  });
});
