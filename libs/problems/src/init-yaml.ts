import { stringify } from 'yaml';
import type {
  Checker,
  JsonObject,
  ProblemData,
  ProblemTestCase,
} from '@libs/database';
import { ProblemDataError } from './problem-data.error';

type InitCase = Record<string, unknown>;
interface Batch extends InitCase {
  points: number;
  batched: InitCase[];
  is_pretest: boolean;
}
export interface CompiledInit {
  yaml: string | null;
  cases: ProblemTestCase[];
}

const CHECKER_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  cpp: 'CPP17',
  pas: 'PAS',
  java: 'JAVA8',
};
const extensionOf = (name: string) =>
  name.split('.').pop()?.toLowerCase() ?? '';
const withArgs = (checker: Checker, args: JsonObject | null) =>
  args && Object.keys(args).length ? { name: checker, args } : checker;

/** Legacy `make_checker` for the problem-wide checker; the custom checker always carries `files` (its uploaded source) with `lang`/`type` defaults the editor may override. */
function problemChecker(
  data: ProblemData,
): string | { name: string; args: JsonObject } {
  if (data.checker !== 'bridged')
    return withArgs(data.checker, data.checkerArgs);
  if (!data.customChecker)
    throw new ProblemDataError(
      'A custom checker file is required for the custom checker.',
    );
  const language =
    CHECKER_LANGUAGE_BY_EXTENSION[extensionOf(data.customChecker)];
  if (!language)
    throw new ProblemDataError(
      'Only C++, Pascal, or Java checkers are supported.',
    );
  return {
    name: 'bridged',
    args: {
      type: 'testlib',
      lang: language,
      ...data.checkerArgs,
      files: data.customChecker,
    },
  };
}

/** A case may override the checker, but a custom checker is problem-wide only (legacy read a field that does not exist and crashed). */
function caseChecker(testCase: ProblemTestCase, index: number) {
  const checker: string = testCase.checker;
  if (checker === 'bridged')
    throw new ProblemDataError(
      `Case #${index}: a custom checker can only be set for the whole problem.`,
    );
  return withArgs(checker as Checker, testCase.checkerArgs);
}

function requireSource(
  name: string | null,
  extension: string,
  message: string,
): string {
  if (!name || extensionOf(name) !== extension)
    throw new ProblemDataError(message);
  return name;
}

/** Legacy `make_grader`. */
function applyGrader(init: InitCase, data: ProblemData): void {
  const args = data.graderArgs ?? {};
  if (data.grader === 'output_only') {
    init.output_only = true;
    return;
  }
  if (data.grader === 'standard') {
    if (args.io_method !== 'file') return;
    const { io_input_file: input, io_output_file: output } = args;
    if (!input || !output)
      throw new ProblemDataError(
        'You must specify both input and output files.',
      );
    if (typeof input !== 'string' || typeof output !== 'string')
      throw new ProblemDataError('Input/Output file must be a string.');
    init.file_io = { input, output };
    return;
  }
  if (data.grader === 'interactive') {
    init.interactive = {
      files: requireSource(
        data.customGrader,
        'cpp',
        'Only accept `.cpp` interactor',
      ),
      type: 'testlib',
      lang: 'CPP17',
    };
    return;
  }
  init.signature_grader = {
    entry: requireSource(data.customGrader, 'cpp', 'Only accept `.cpp` entry'),
    header: requireSource(data.customHeader, 'h', 'Only accept `.h` header'),
    // Some problems want contestants to write main themselves (judge-server#730).
    ...(args.allow_main ? { allow_main: true } : {}),
  };
}

const splitLines = (text: string) => text.split(/\r?\n/);
const applyCaseOptions = (target: InitCase, testCase: ProblemTestCase) => {
  if (testCase.generatorArgs)
    target.generator_args = splitLines(testCase.generatorArgs);
  if (testCase.outputLimit !== null)
    target.output_limit_length = testCase.outputLimit;
  if (testCase.outputPrefix !== null)
    target.output_prefix_length = testCase.outputPrefix;
};

/** Port of legacy `ProblemDataCompiler.make_init`: null yaml when there is nothing to write; `cases` are the normalised rows to store back. */
export function compileInitYaml(
  data: ProblemData,
  archiveEntries: ReadonlySet<string>,
): CompiledInit {
  const cases = data.cases.map((testCase) => ({ ...testCase }));
  if (!cases.length) return { yaml: null, cases };
  const top: InitCase[] = [];
  let batch: Batch | null = null;
  let totalPoints = 0;
  const endBatch = (open: Batch) => {
    if (!open.batched.length)
      throw new ProblemDataError('Empty batches not allowed.');
    top.push(open);
    batch = null;
  };
  cases.forEach((testCase, position) => {
    const index = position + 1;
    if (testCase.type === 'C') {
      const entry: InitCase = {};
      if (batch) {
        testCase.points = null;
        testCase.isPretest = batch.is_pretest;
      } else {
        if (testCase.points === null)
          throw new ProblemDataError(
            `Points must be defined for non-batch case #${index}.`,
          );
        entry.is_pretest = testCase.isPretest;
      }
      if (!data.generator) {
        if (!archiveEntries.has(testCase.input))
          throw new ProblemDataError(
            `Input file for case ${index} does not exist: ${testCase.input}`,
          );
        if (!archiveEntries.has(testCase.output))
          throw new ProblemDataError(
            `Output file for case ${index} does not exist: ${testCase.output}`,
          );
      }
      if (testCase.input) entry.in = testCase.input;
      if (testCase.output) entry.out = testCase.output;
      if (testCase.points !== null) {
        entry.points = testCase.points;
        totalPoints += testCase.points;
      }
      applyCaseOptions(entry, testCase);
      if (testCase.checker) entry.checker = caseChecker(testCase, index);
      else testCase.checkerArgs = null;
      (batch ? batch.batched : top).push(entry);
    } else if (testCase.type === 'S') {
      if (batch) endBatch(batch);
      if (testCase.points === null)
        throw new ProblemDataError(
          `Batch start case #${index} requires points.`,
        );
      totalPoints += testCase.points;
      batch = {
        points: testCase.points,
        batched: [],
        is_pretest: testCase.isPretest,
      };
      applyCaseOptions(batch, testCase);
      if (testCase.checker) batch.checker = caseChecker(testCase, index);
      else testCase.checkerArgs = null;
      testCase.input = '';
      testCase.output = '';
    } else {
      if (!batch)
        throw new ProblemDataError(
          `Attempt to end batch outside of one in case #${index}.`,
        );
      Object.assign(testCase, {
        isPretest: batch.is_pretest,
        input: '',
        output: '',
        generatorArgs: '',
        checker: '',
        checkerArgs: null,
      });
      endBatch(batch);
    }
  });
  if (totalPoints <= 0)
    throw new ProblemDataError('Total points must be greater than 0.');
  if (batch) endBatch(batch);

  const takePretest = (entry: InitCase) => {
    const flag = entry.is_pretest as boolean;
    delete entry.is_pretest;
    return flag;
  };
  const pretests: InitCase[] = [];
  const tests: InitCase[] = [];
  for (const entry of top) (takePretest(entry) ? pretests : tests).push(entry);

  const init: InitCase = {};
  if (data.archive) init.archive = data.archive;
  if (data.generator) init.generator = data.generator;
  if (pretests.length) init.pretest_test_cases = pretests;
  if (tests.length) init.test_cases = tests;
  if (data.outputLimit !== null) init.output_limit_length = data.outputLimit;
  if (data.outputPrefix !== null) init.output_prefix_length = data.outputPrefix;
  init.checker = problemChecker(data);
  applyGrader(init, data);
  const hints = [
    ...(data.unicode ? ['unicode'] : []),
    ...(data.nobigmath ? ['nobigmath'] : []),
  ];
  if (hints.length) init.hints = hints;
  // PyYAML safe_dump sorts keys; the judge does not care, diffs do.
  return {
    yaml: stringify(init, { sortMapEntries: true, lineWidth: 0 }),
    cases,
  };
}
