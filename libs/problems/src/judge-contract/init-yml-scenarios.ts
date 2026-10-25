import { EMPTY_TEST_CASE } from '@libs/database';
import type { ProblemData, ProblemTestCase } from '@libs/database';

/**
 * Problem data the backend's writer turns into init.yml, one class of the backend-judge contract each: case plans
 * (batches, pretests, points, limits), checkers and their arguments, graders, and names that must stay strings.
 */
export interface InitYmlScenario {
  name: string;
  data: Partial<ProblemData>;
}

type Row = Partial<ProblemTestCase>;
const row = (overrides: Row): ProblemTestCase => ({
  ...EMPTY_TEST_CASE,
  ...overrides,
});
const testCase = (input: string, output: string, extra: Row = {}) =>
  row({ input, output, points: 1, ...extra });
const batchStart = (points: number, extra: Row = {}) =>
  row({ type: 'S', points, ...extra });
const batchEnd = () => row({ type: 'E' });
const numbered = (index: number, extra: Row = {}) =>
  testCase(`${index}.in`, `${index}.out`, extra);
const two = () => [numbered(1), numbered(2)];

const BRIDGED = {
  checker: 'bridged' as const,
  customChecker: 'checker.cpp',
};

/** Names a YAML 1.1 or 1.2 reader could retype or misread when written plain. */
const HOSTILE_NAMES = [
  '08',
  '1e5',
  '1e-5',
  '12e3',
  '0o17',
  '0x1F',
  '1_000',
  'yes',
  'null',
  '-1',
  'a b ',
  'x:y.in',
  '#a.in',
  '-a.in',
  'q"uote.in',
  'đề 1.inp',
  '😀.in',
  'a\u0085b.in',
  'tab\there.in',
];

export const INIT_YML_SCENARIOS: InitYmlScenario[] = [
  { name: 'plain', data: { cases: [numbered(1), numbered(2, { points: 3 })] } },
  {
    name: 'batches_and_plain',
    data: {
      cases: [
        batchStart(30),
        numbered(1),
        numbered(2),
        batchEnd(),
        numbered(3, { points: 10 }),
        batchStart(60),
        numbered(4),
        batchEnd(),
      ],
    },
  },
  {
    name: 'trailing_open_batch',
    data: { cases: [numbered(1), batchStart(5), numbered(2), numbered(3)] },
  },
  {
    name: 'pretests_interleaved',
    data: {
      cases: [
        numbered(1, { isPretest: true }),
        numbered(2),
        batchStart(20, { isPretest: true }),
        numbered(3),
        batchEnd(),
        numbered(4, { isPretest: true, points: 5 }),
        batchStart(7),
        numbered(5),
        batchEnd(),
      ],
    },
  },
  {
    name: 'zero_point_batch_and_case',
    data: {
      cases: [
        batchStart(0),
        numbered(1),
        batchEnd(),
        numbered(2, { points: 0 }),
        numbered(3, { points: 4 }),
      ],
    },
  },
  {
    name: 'limits_problem_batch_case',
    data: {
      outputLimit: 1000,
      outputPrefix: 9,
      cases: [
        batchStart(10, { outputLimit: 500, outputPrefix: 3 }),
        numbered(1),
        numbered(2, { outputLimit: 7, outputPrefix: 0 }),
        batchEnd(),
        numbered(3, { outputLimit: 64 * 1024 * 1024 }),
      ],
    },
  },
  { name: 'output_limit_zero', data: { outputLimit: 0, cases: [numbered(1)] } },
  {
    name: 'max_safe_numbers',
    data: {
      outputPrefix: Number.MAX_SAFE_INTEGER,
      cases: [numbered(1, { points: Number.MAX_SAFE_INTEGER })],
    },
  },
  {
    name: 'checker_floats',
    data: {
      checker: 'floats',
      checkerArgs: { precision: 20, error_mode: 'relative' },
      cases: two(),
    },
  },
  {
    name: 'checker_linematches',
    data: {
      checker: 'linematches',
      checkerArgs: {
        point_distribution: [1, 0, 3],
        filler_lines_required: false,
      },
      cases: two(),
    },
  },
  {
    name: 'checker_linematches_unsafe_weight',
    data: {
      checker: 'linematches',
      checkerArgs: { point_distribution: [2 ** 60, 1] },
      cases: two(),
    },
  },
  {
    name: 'bridged_percent_headers',
    data: {
      ...BRIDGED,
      checkerArgs: {
        type: 'testlib',
        treat_checker_points_as_percentage: true,
      },
      helperHeaders: ['testlib.h', 'limits.hpp'],
      customHeader: 'extra.h',
      cases: [numbered(1)],
    },
  },
  {
    name: 'bridged_numeric_header_names',
    data: { ...BRIDGED, helperHeaders: ['1e5', '0o17'], cases: [numbered(1)] },
  },
  {
    name: 'interactive_numeric_header_name',
    data: {
      grader: 'interactive',
      customGrader: 'interactor.cpp',
      helperHeaders: ['12e3'],
      cases: [numbered(1)],
    },
  },
  {
    name: 'interactive_polygon_checker_percent',
    data: {
      grader: 'interactive',
      customGrader: 'interactor.cpp',
      interactiveChecker: true,
      graderArgs: { treat_checker_points_as_percentage: true },
      helperHeaders: ['testlib.h'],
      ...BRIDGED,
      checkerArgs: {
        type: 'testlib',
        treat_checker_points_as_percentage: true,
      },
      cases: two(),
    },
  },
  {
    name: 'file_io_unicode',
    data: {
      grader: 'standard',
      graderArgs: {
        io_method: 'file',
        io_input_file: 'dữliệu.inp',
        io_output_file: 'kết quả.out',
      },
      cases: [numbered(1)],
    },
  },
  {
    name: 'signature_allow_main',
    data: {
      grader: 'signature',
      customGrader: 'entry.cpp',
      customHeader: 'sig.h',
      graderArgs: { allow_main: true },
      cases: [numbered(1)],
    },
  },
  { name: 'output_only', data: { grader: 'output_only', cases: two() } },
  {
    name: 'case_file_names',
    data: {
      unicode: true,
      cases: HOSTILE_NAMES.map((name, index) => testCase(name, `${index}.ans`)),
    },
  },
  {
    name: 'generator_args',
    data: { cases: [numbered(1, { generatorArgs: '1e5\ntrue\n- x\n"q"' })] },
  },
];
