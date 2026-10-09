// scripts/judge/emit-init-fixtures.ts
// Writes every init.yml shape compileInitYaml emits into judge-v2's fixture directory.
// Run: npx ts-node -r tsconfig-paths/register scripts/judge/emit-init-fixtures.ts <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileInitYaml } from '@libs/problems';
import { EMPTY_TEST_CASE, emptyProblemData } from '@libs/database';

type Data = ReturnType<typeof emptyProblemData>;
const plain = (input: string, points: number | null, extra = {}) => ({
  ...EMPTY_TEST_CASE,
  type: 'C' as const,
  input,
  output: input.replace('.in', '.out'),
  points,
  ...extra,
});
const start = (points: number, isPretest = false) => ({
  ...EMPTY_TEST_CASE,
  type: 'S' as const,
  points,
  isPretest,
});
const end = () => ({ ...EMPTY_TEST_CASE, type: 'E' as const });

const SHAPES: Record<string, Partial<Data>> = {
  plain: { cases: [plain('1.in', 50), plain('2.in', 50)] },
  archive: { archive: 'tests.zip', cases: [plain('1.in', 100)] },
  batches: {
    cases: [
      start(40),
      plain('1.in', null),
      plain('2.in', null),
      end(),
      plain('3.in', 60),
    ],
  },
  pretests: {
    cases: [
      plain('1.in', 10, { isPretest: true }),
      start(90, true),
      plain('2.in', null),
      end(),
      plain('3.in', 0),
    ],
  },
  output_limits: {
    outputLimit: 1024,
    outputPrefix: 64,
    cases: [plain('1.in', 100, { outputLimit: 10, outputPrefix: 5 })],
  },
  floats: {
    checker: 'floats',
    checkerArgs: { precision: 4 },
    cases: [plain('1.in', 100)],
  },
  floatsabs: { checker: 'floatsabs', cases: [plain('1.in', 100)] },
  floatsrel: { checker: 'floatsrel', cases: [plain('1.in', 100)] },
  identical: { checker: 'identical', cases: [plain('1.in', 100)] },
  linecount: { checker: 'linecount', cases: [plain('1.in', 100)] },
  case_checker: {
    cases: [plain('1.in', 50, { checker: 'identical' }), plain('2.in', 50)],
  },
  testlib_cpp: {
    checker: 'bridged',
    customChecker: 'chk.cpp',
    cases: [plain('1.in', 100)],
  },
  default_pas: {
    checker: 'bridged',
    customChecker: 'chk.pas',
    checkerArgs: { type: 'default' },
    cases: [plain('1.in', 100)],
  },
  testlib_java: {
    checker: 'bridged',
    customChecker: 'Chk.java',
    cases: [plain('1.in', 100)],
  },
  file_io: {
    grader: 'standard',
    graderArgs: {
      io_method: 'file',
      io_input_file: 'sum.inp',
      io_output_file: 'sum.out',
    },
    cases: [plain('1.in', 100)],
  },
  output_only: { grader: 'output_only', cases: [plain('1.in', 100)] },
  interactive: {
    grader: 'interactive',
    customGrader: 'inter.cpp',
    cases: [plain('1.in', 100)],
  },
  unicode: { unicode: true, cases: [plain('1.in', 100)] },
  signature: {
    grader: 'signature',
    customGrader: 'grader.cpp',
    customHeader: 'sol.h',
    cases: [plain('1.in', 100)],
  },
};

const out = process.argv[2];
if (!out) throw new Error('usage: emit-init-fixtures.ts <out-dir>');
mkdirSync(out, { recursive: true });
for (const [name, shape] of Object.entries(SHAPES)) {
  const data = { ...emptyProblemData(), ...shape };
  const files = new Set(
    data.cases
      .flatMap((testCase) => [testCase.input, testCase.output])
      .filter(Boolean),
  );
  const { yaml } = compileInitYaml(data, files);
  writeFileSync(join(out, `${name}.yml`), yaml ?? '');
}
console.log(`wrote ${Object.keys(SHAPES).length} fixtures to ${out}`);
