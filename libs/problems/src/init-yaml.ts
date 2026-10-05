import type { JsonObject, ProblemData, ProblemTestCase } from '@libs/database';
import { CUSTOM_CHECKER_TYPES } from '@libs/database';
import { extensionOf } from './file-names';
import { ProblemDataError } from './problem-data.error';
import { emitYaml } from './yaml-emit';

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

const MAX_ARGS_DEPTH = 8;
const MAX_ARGS_ENTRIES = 200;
const MAX_ARGS_NODES = 8192;
const MAX_ARGS_JSON_LENGTH = 8192;
const MAX_ARGS_KEY_LENGTH = 100;

/** Args are arbitrary editor JSON: bound depth, width and size iteratively before anything recurses over them. */
function assertBoundedArgs(args: JsonObject | null): void {
  const tooLarge = new ProblemDataError('Checker arguments are too large.');
  const pending: [unknown, number][] = [[args, 0]];
  let nodes = 0;
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [value, depth] = next;
    if (++nodes > MAX_ARGS_NODES) throw tooLarge;
    if (typeof value !== 'object' || value === null) continue;
    const keys = Object.keys(value);
    if (depth >= MAX_ARGS_DEPTH || keys.length > MAX_ARGS_ENTRIES)
      throw tooLarge;
    if (
      !Array.isArray(value) &&
      keys.some((key) => key.length > MAX_ARGS_KEY_LENGTH)
    )
      throw tooLarge;
    for (const child of Object.values(value)) pending.push([child, depth + 1]);
  }
  if (JSON.stringify(args).length > MAX_ARGS_JSON_LENGTH) throw tooLarge;
}

const withArgs = (checker: string, args: JsonObject | null) => {
  assertBoundedArgs(args);
  return args && Object.keys(args).length ? { name: checker, args } : checker;
};

function integerOrNull(value: number | null, label: string): number | null {
  if (value !== null && !Number.isSafeInteger(value))
    throw new ProblemDataError(`${label} must be an integer.`);
  return value;
}

/** Legacy `make_checker` for the problem-wide checker; the custom checker always carries `files` (its uploaded source) with a `type` the editor may choose (default testlib); `files` and `lang` always come from the uploaded source. */
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
  const args = { type: 'testlib', ...data.checkerArgs };
  if (!(CUSTOM_CHECKER_TYPES as readonly unknown[]).includes(args.type))
    throw new ProblemDataError('Unknown custom checker type.');
  return withArgs('bridged', {
    ...args,
    lang: language,
    files: data.customChecker,
  });
}

/** A case may override the checker, but a custom checker is problem-wide only (legacy read a field that does not exist and crashed). */
function caseChecker(testCase: ProblemTestCase, index: number) {
  const checker: string = testCase.checker;
  if (checker === 'bridged')
    throw new ProblemDataError(
      `Case #${index}: a custom checker can only be set for the whole problem.`,
    );
  return withArgs(checker, testCase.checkerArgs);
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
  assertBoundedArgs(data.graderArgs);
  const args = data.graderArgs ?? {};
  if (data.grader === 'output_only') {
    init.output_only = true;
    return;
  }
  if (data.grader === 'standard') {
    if (args.io_method !== 'file') return;
    const { io_input_file: input, io_output_file: output } = args;
    const unset = (name: unknown) => name === undefined || name === '';
    if (unset(input) || unset(output))
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

/** Python `str.splitlines()` for the line endings that matter: a trailing line break does not add an empty line. */
const splitLines = (text: string) => {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};
/** Options shared by plain cases and batch starts; a case without a checker drops stale checker args. */
function applyCaseOptions(
  target: InitCase,
  testCase: ProblemTestCase,
  index: number,
): void {
  if (testCase.generatorArgs)
    target.generator_args = splitLines(testCase.generatorArgs);
  const outputLimit = integerOrNull(
    testCase.outputLimit,
    `Case #${index}: output limit`,
  );
  if (outputLimit !== null) target.output_limit_length = outputLimit;
  const outputPrefix = integerOrNull(
    testCase.outputPrefix,
    `Case #${index}: output prefix`,
  );
  if (outputPrefix !== null) target.output_prefix_length = outputPrefix;
  if (testCase.checker) target.checker = caseChecker(testCase, index);
  else testCase.checkerArgs = null;
}

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
    integerOrNull(testCase.points, `Case #${index}: points`);
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
      applyCaseOptions(entry, testCase, index);
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
      applyCaseOptions(batch, testCase, index);
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
  const outputLimit = integerOrNull(data.outputLimit, 'Output limit');
  if (outputLimit !== null) init.output_limit_length = outputLimit;
  const outputPrefix = integerOrNull(data.outputPrefix, 'Output prefix');
  if (outputPrefix !== null) init.output_prefix_length = outputPrefix;
  init.checker = problemChecker(data);
  applyGrader(init, data);
  const hints = [
    ...(data.unicode ? ['unicode'] : []),
    ...(data.nobigmath ? ['nobigmath'] : []),
  ];
  if (hints.length) init.hints = hints;
  return { yaml: emitYaml(init), cases };
}
