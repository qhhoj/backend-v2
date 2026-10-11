import { parse } from 'yaml';
import { EMPTY_TEST_CASE, emptyProblemData } from '@libs/database';
import type { ProblemData, ProblemTestCase } from '@libs/database';
import { compileInitYaml } from './init-yaml';
import { ProblemDataError } from './problem-data.error';

const testCase = (overrides: Partial<ProblemTestCase>): ProblemTestCase => ({
  ...EMPTY_TEST_CASE,
  ...overrides,
});
const plain = (index: number, extra: Partial<ProblemTestCase> = {}) =>
  testCase({
    input: `${index}.in`,
    output: `${index}.out`,
    points: 1,
    ...extra,
  });
const data = (overrides: Partial<ProblemData>): ProblemData => ({
  ...emptyProblemData(),
  archive: 'tests.zip',
  ...overrides,
});
const files = new Set(['1.in', '1.out', '2.in', '2.out', '3.in', '3.out']);
const compile = (overrides: Partial<ProblemData>, entries = files) =>
  compileInitYaml(data(overrides), entries);
const init = (overrides: Partial<ProblemData>, entries = files) =>
  parse(compile(overrides, entries).yaml ?? '') as Record<string, unknown>;
const failsWith = (
  overrides: Partial<ProblemData>,
  message: string,
  entries = files,
) =>
  expect(() => compile(overrides, entries)).toThrow(
    new ProblemDataError(message),
  );

describe('compileInitYaml', () => {
  it('emits sorted keys, archive, test cases and the standard checker', () => {
    expect(
      compile({ cases: [plain(1), plain(2, { isPretest: true })] }).yaml,
    ).toBe(
      [
        'archive: tests.zip',
        'checker: standard',
        'pretest_test_cases:',
        '  - in: 2.in',
        '    out: 2.out',
        '    points: 1',
        'test_cases:',
        '  - in: 1.in',
        '    out: 1.out',
        '    points: 1',
        '',
      ].join('\n'),
    );
  });
  it('builds batches: members lose their points and inherit the batch pretest flag, S/E rows lose files', () => {
    const { yaml, cases } = compile({
      cases: [
        testCase({
          type: 'S',
          points: 30,
          isPretest: true,
          input: 'junk',
          generatorArgs: 'a\nb',
          outputLimit: 5,
        }),
        plain(1, { points: 7, isPretest: false }),
        plain(2, { points: null }),
        testCase({
          type: 'E',
          input: 'junk',
          output: 'junk',
          generatorArgs: 'x',
          checker: 'floats',
          checkerArgs: { precision: 2 },
        }),
        plain(3, { points: 70 }),
      ],
    });
    expect(parse(yaml!)).toEqual({
      archive: 'tests.zip',
      checker: 'standard',
      pretest_test_cases: [
        {
          points: 30,
          generator_args: ['a', 'b'],
          output_limit_length: 5,
          batched: [
            { in: '1.in', out: '1.out' },
            { in: '2.in', out: '2.out' },
          ],
        },
      ],
      test_cases: [{ in: '3.in', out: '3.out', points: 70 }],
    });
    expect(cases[0]).toMatchObject({
      type: 'S',
      input: '',
      output: '',
      points: 30,
    });
    expect(cases[1]).toMatchObject({ points: null, isPretest: true });
    expect(cases[3]).toMatchObject({
      type: 'E',
      input: '',
      output: '',
      generatorArgs: '',
      checker: '',
      checkerArgs: null,
      isPretest: true,
    });
  });
  it.each([
    [
      'Points must be defined for non-batch case #1.',
      [plain(1, { points: null })],
    ],
    [
      'Batch start case #1 requires points.',
      [testCase({ type: 'S' }), plain(1), testCase({ type: 'E' })],
    ],
    [
      'Attempt to end batch outside of one in case #1.',
      [testCase({ type: 'E' })],
    ],
    [
      'Empty batches not allowed.',
      [testCase({ type: 'S', points: 1 }), testCase({ type: 'E' })],
    ],
    [
      'Empty batches not allowed.',
      [
        testCase({ type: 'S', points: 1 }),
        testCase({ type: 'S', points: 1 }),
        plain(1),
        testCase({ type: 'E' }),
      ],
    ],
    ['Total points must be greater than 0.', [plain(1, { points: 0 })]],
    [
      'Total points must be greater than 0.',
      [testCase({ type: 'S', points: 0 })],
    ],
    ['Input file for case 1 does not exist: 9.in', [plain(9)]],
    [
      'Output file for case 2 does not exist: 9.out',
      [plain(1), plain(2, { output: '9.out' })],
    ],
    [
      'Case #1: a custom checker can only be set for the whole problem.',
      [plain(1, { checker: 'bridged' as never })],
    ],
  ])('rejects: %s', (message, cases) => failsWith({ cases }, message));
  it('closes an open batch at the end and counts its points', () =>
    expect(
      init({ cases: [testCase({ type: 'S', points: 5 }), plain(1)] }),
    ).toMatchObject({
      test_cases: [{ points: 5, batched: [{ in: '1.in', out: '1.out' }] }],
    }));
  it('skips the file check with a generator and names it', () =>
    expect(
      init(
        {
          generator: 'gen.cpp',
          cases: [plain(9, { generatorArgs: '1 2\n3' })],
        },
        new Set(),
      ),
    ).toMatchObject({
      generator: 'gen.cpp',
      test_cases: [
        { in: '9.in', out: '9.out', points: 1, generator_args: ['1 2', '3'] },
      ],
    }));
  it('emits per-case checkers with and without args, and clears args of cases without a checker', () => {
    const { yaml, cases } = compile({
      cases: [
        plain(1, { checker: 'floats', checkerArgs: { precision: 3 } }),
        plain(2, { checker: 'identical' }),
        plain(3, { checkerArgs: { stale: true } }),
      ],
    });
    expect((parse(yaml!) as { test_cases: unknown[] }).test_cases).toEqual([
      {
        in: '1.in',
        out: '1.out',
        points: 1,
        checker: { name: 'floats', args: { precision: 3 } },
      },
      { in: '2.in', out: '2.out', points: 1, checker: 'identical' },
      { in: '3.in', out: '3.out', points: 1 },
    ]);
    expect(cases[2].checkerArgs).toBeNull();
  });
  it('composes the custom checker from the uploaded source: files, lang by extension, type default testlib', () => {
    expect(
      init({
        checker: 'bridged',
        customChecker: 'chk.cpp',
        checkerArgs: { type: 'themis' },
        cases: [plain(1)],
      }).checker,
    ).toEqual({
      name: 'bridged',
      args: { files: 'chk.cpp', lang: 'CPP17', type: 'themis' },
    });
    expect(
      init({ checker: 'bridged', customChecker: 'chk.pas', cases: [plain(1)] })
        .checker,
    ).toEqual({
      name: 'bridged',
      args: { files: 'chk.pas', lang: 'PAS', type: 'testlib' },
    });
    failsWith(
      { checker: 'bridged', cases: [plain(1)] },
      'A custom checker file is required for the custom checker.',
    );
    failsWith(
      { checker: 'bridged', customChecker: 'chk.py', cases: [plain(1)] },
      'Only C++, Pascal, or Java checkers are supported.',
    );
  });
  it('maps graders: file io, interactive, signature (with allow_main), output_only', () => {
    expect(
      init({
        graderArgs: {
          io_method: 'file',
          io_input_file: 'a.inp',
          io_output_file: 'a.out',
        },
        cases: [plain(1)],
      }).file_io,
    ).toEqual({ input: 'a.inp', output: 'a.out' });
    failsWith(
      {
        graderArgs: { io_method: 'file', io_input_file: 'a.inp' },
        cases: [plain(1)],
      },
      'You must specify both input and output files.',
    );
    failsWith(
      {
        graderArgs: {
          io_method: 'file',
          io_input_file: 1,
          io_output_file: 'a',
        },
        cases: [plain(1)],
      },
      'Input/Output file must be a string.',
    );
    expect(
      init({
        grader: 'interactive',
        customGrader: 'inter.cpp',
        cases: [plain(1)],
      }).interactive,
    ).toEqual({ files: 'inter.cpp', type: 'testlib', lang: 'CPP17' });
    failsWith(
      { grader: 'interactive', customGrader: 'inter.py', cases: [plain(1)] },
      'Only accept `.cpp` interactor',
    );
    failsWith(
      { grader: 'interactive', cases: [plain(1)] },
      'Only accept `.cpp` interactor',
    );
    expect(
      init({
        grader: 'signature',
        customGrader: 'entry.cpp',
        customHeader: 'sig.h',
        graderArgs: { allow_main: true },
        cases: [plain(1)],
      }).signature_grader,
    ).toEqual({ entry: 'entry.cpp', header: 'sig.h', allow_main: true });
    failsWith(
      {
        grader: 'signature',
        customGrader: 'entry.cpp',
        customHeader: 'sig.hpp',
        cases: [plain(1)],
      },
      'Only accept `.h` header',
    );
    failsWith(
      {
        grader: 'signature',
        customGrader: 'entry.c',
        customHeader: 'sig.h',
        cases: [plain(1)],
      },
      'Only accept `.cpp` entry',
    );
  });
  it.each([
    ['../x', 'a.out'],
    ['a.inp', '/etc/passwd'],
    ['sub/a.inp', 'a.out'],
    ['input', 'a.out'],
    ['main', 'a.out'],
    ['a.inp', '.stderr'],
  ])(
    'refuses file io names that leave the box or shadow its files: %s, %s',
    (input, output) =>
      failsWith(
        {
          graderArgs: {
            io_method: 'file',
            io_input_file: input,
            io_output_file: output,
          },
          cases: [plain(1)],
        },
        'Input/Output file must be a plain file name.',
      ),
  );

  it('quotes hostile strings so PyYAML (YAML 1.1) keeps them strings', () => {
    const hostile = [
      'yes',
      'a\tb',
      '=',
      '<<',
      '1_000',
      '1:30',
      '2024-01-01',
      'a\u0085b',
      '0b101',
      '1 2',
    ];
    expect(
      compile({ cases: [plain(1, { generatorArgs: hostile.join('\n') })] })
        .yaml,
    ).toBe(
      [
        'archive: tests.zip',
        'checker: standard',
        'test_cases:',
        '  - generator_args:',
        '      - "yes"',
        '      - "a\\tb"',
        '      - "="',
        '      - "<<"',
        '      - "1_000"',
        '      - "1:30"',
        '      - "2024-01-01"',
        '      - "a\\u0085b"',
        '      - "0b101"',
        '      - 1 2',
        '    in: 1.in',
        '    out: 1.out',
        '    points: 1',
        '',
      ].join('\n'),
    );
  });
  it('bounds checker and grader args', () => {
    const deep = (levels: number) => {
      const root: Record<string, unknown> = {};
      let cursor = root;
      for (let level = 0; level < levels; level++)
        cursor = cursor.k = {} as Record<string, unknown>;
      return root;
    };
    const wide = Object.fromEntries(
      Array.from({ length: 50000 }, (_item, index) => [`k${index}`, index]),
    );
    const message = 'Checker arguments are too large.';
    for (const args of [deep(200000), wide, deep(9)]) {
      const started = performance.now();
      failsWith(
        { checker: 'floats', checkerArgs: args, cases: [plain(1)] },
        message,
      );
      failsWith({ graderArgs: args, cases: [plain(1)] }, message);
      failsWith(
        { cases: [plain(1, { checker: 'floats', checkerArgs: args })] },
        message,
      );
      expect(performance.now() - started).toBeLessThan(1000);
    }
    expect(() =>
      compile({ checker: 'floats', checkerArgs: deep(7), cases: [plain(1)] }),
    ).not.toThrow();
    failsWith(
      {
        checker: 'floats',
        checkerArgs: { text: 'x'.repeat(9000) },
        cases: [plain(1)],
      },
      message,
    );
  });
  it('validates the custom checker type and keeps files/lang server-derived', () => {
    failsWith(
      {
        checker: 'bridged',
        customChecker: 'chk.cpp',
        checkerArgs: { type: 'nope' },
        cases: [plain(1)],
      },
      'Unknown custom checker type.',
    );
    expect(
      init({
        checker: 'bridged',
        customChecker: 'chk.cpp',
        checkerArgs: {
          files: 'evil',
          lang: 'PY3',
          treat_checker_points_as_percentage: true,
        },
        cases: [plain(1)],
      }).checker,
    ).toEqual({
      name: 'bridged',
      args: {
        files: 'chk.cpp',
        lang: 'CPP17',
        type: 'testlib',
        treat_checker_points_as_percentage: true,
      },
    });
  });
  it('requires safe integers for points and limits', () => {
    failsWith(
      { cases: [plain(1, { points: 1.5 })] },
      'Case #1: points must be an integer.',
    );
    failsWith(
      { cases: [plain(1, { outputLimit: 2 ** 60 })] },
      'Case #1: output limit must be an integer.',
    );
    failsWith(
      { outputPrefix: 0.5, cases: [plain(1)] },
      'Output prefix must be an integer.',
    );
  });
  it('splits generator args like Python splitlines', () => {
    const lines = (generatorArgs: string) =>
      (
        init({ cases: [plain(1, { generatorArgs })] }).test_cases as {
          generator_args: string[];
        }[]
      )[0].generator_args;
    expect(lines('a\r\nb\nc\rd\n')).toEqual(['a', 'b', 'c', 'd']);
    expect(lines('\n')).toEqual(['']);
  });
});
