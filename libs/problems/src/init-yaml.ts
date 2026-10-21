import type { JsonObject, ProblemData, ProblemTestCase } from '@libs/database';
import { CUSTOM_CHECKER_TYPES } from '@libs/database';
import { checkerHeadersOf, runsInteractiveChecker } from '@libs/judging';
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

/** Judge language of an uploaded checker or interactor, by extension. */
export const CHECKER_LANGUAGE_BY_EXTENSION: Record<string, string> = {
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

/** A source alone is one name; with headers it is a list, source first, which the judge compiles side by side. */
const filesOf = (source: string, headers: string[]): string | string[] =>
  headers.length ? [source, ...headers] : source;

/** Legacy `make_checker` for the problem-wide checker; the custom checker always carries `files` (its uploaded source, then any Polygon headers) with a `type` the editor may choose (default testlib); `files` and `lang` always come from the uploaded source. */
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
    files: filesOf(data.customChecker, checkerHeadersOf(data)),
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

/** Names the judge keeps for itself inside the box (judge-v2 `case_file` rule). */
const RESERVED_BOX_NAMES: ReadonlySet<string> = new Set([
  'input',
  'output',
  'main',
  '.stderr',
]);

/** A file io name is joined to the box directory by the judge: only a plain name that cannot leave it or shadow the judge's own files is allowed. */
function plainBoxFileName(name: string): string {
  if (
    name === '' ||
    name.startsWith('.') ||
    /[/\\]/.test(name) ||
    RESERVED_BOX_NAMES.has(name)
  )
    throw new ProblemDataError('Input/Output file must be a plain file name.');
  return name;
}

/** The judge compiles the listed headers beside the interactor, so its `#include "testlib.h"` finds the package's own copy first. A Polygon interactive problem also names the problem checker, which reads what the interactor wrote once it accepts. */
function interactiveSpec(data: ProblemData): InitCase {
  const interactor = requireSource(
    data.customGrader,
    'cpp',
    'Only accept `.cpp` interactor',
  );
  return {
    files: filesOf(interactor, data.helperHeaders ?? []),
    type: 'testlib',
    lang: 'CPP17',
    ...(runsInteractiveChecker(data) ? { checker: problemChecker(data) } : {}),
  };
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
    init.file_io = {
      input: plainBoxFileName(input),
      output: plainBoxFileName(output),
    };
    return;
  }
  if (data.grader === 'interactive') {
    init.interactive = interactiveSpec(data);
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

/** The cases grouped so far: top-level entries, the batch still open, and the points counted. */
interface Grouping {
  topLevel: InitCase[];
  openBatch: Batch | null;
  totalPoints: number;
}
interface CaseFiles {
  hasGenerator: boolean;
  archiveEntries: ReadonlySet<string>;
}

function closeBatch(grouping: Grouping, batch: Batch): void {
  if (!batch.batched.length)
    throw new ProblemDataError('Empty batches not allowed.');
  grouping.topLevel.push(batch);
  grouping.openBatch = null;
}

/** Without a generator every case names files that must be in the archive. */
function assertCaseFiles(
  testCase: ProblemTestCase,
  index: number,
  archiveEntries: ReadonlySet<string>,
): void {
  if (!archiveEntries.has(testCase.input))
    throw new ProblemDataError(
      `Input file for case ${index} does not exist: ${testCase.input}`,
    );
  if (!archiveEntries.has(testCase.output))
    throw new ProblemDataError(
      `Output file for case ${index} does not exist: ${testCase.output}`,
    );
}

/** A `C` row: inside a batch it loses its points and takes the batch's pretest flag; outside one it must carry points. */
function addPlainCase(
  grouping: Grouping,
  testCase: ProblemTestCase,
  index: number,
  { hasGenerator, archiveEntries }: CaseFiles,
): void {
  const entry: InitCase = {};
  const batch = grouping.openBatch;
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
  if (!hasGenerator) assertCaseFiles(testCase, index, archiveEntries);
  if (testCase.input) entry.in = testCase.input;
  if (testCase.output) entry.out = testCase.output;
  if (testCase.points !== null) {
    entry.points = testCase.points;
    grouping.totalPoints += testCase.points;
  }
  applyCaseOptions(entry, testCase, index);
  (batch ? batch.batched : grouping.topLevel).push(entry);
}

/** An `S` row closes any open batch and opens a new one; the row itself keeps no files. */
function startBatch(
  grouping: Grouping,
  testCase: ProblemTestCase,
  index: number,
): void {
  if (grouping.openBatch) closeBatch(grouping, grouping.openBatch);
  if (testCase.points === null)
    throw new ProblemDataError(`Batch start case #${index} requires points.`);
  grouping.totalPoints += testCase.points;
  const batch: Batch = {
    points: testCase.points,
    batched: [],
    is_pretest: testCase.isPretest,
  };
  grouping.openBatch = batch;
  applyCaseOptions(batch, testCase, index);
  testCase.input = '';
  testCase.output = '';
}

/** An `E` row closes the open batch and is cleared of everything a case could carry. */
function endBatch(
  grouping: Grouping,
  testCase: ProblemTestCase,
  index: number,
): void {
  const batch = grouping.openBatch;
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
  closeBatch(grouping, batch);
}

/** Legacy row walk: C, S and E rows become top-level cases and batches; the total is checked before a trailing batch is closed. */
function groupCases(cases: ProblemTestCase[], files: CaseFiles): InitCase[] {
  const grouping: Grouping = { topLevel: [], openBatch: null, totalPoints: 0 };
  cases.forEach((testCase, position) => {
    const index = position + 1;
    integerOrNull(testCase.points, `Case #${index}: points`);
    if (testCase.type === 'C') addPlainCase(grouping, testCase, index, files);
    else if (testCase.type === 'S') startBatch(grouping, testCase, index);
    else endBatch(grouping, testCase, index);
  });
  if (grouping.totalPoints <= 0)
    throw new ProblemDataError('Total points must be greater than 0.');
  if (grouping.openBatch) closeBatch(grouping, grouping.openBatch);
  return grouping.topLevel;
}

/** `is_pretest` is a routing marker, not an init.yml key: it picks the list and is removed. */
function splitPretestsAndDropMarker(entries: InitCase[]): {
  pretests: InitCase[];
  tests: InitCase[];
} {
  const pretests: InitCase[] = [];
  const tests: InitCase[] = [];
  for (const entry of entries) {
    const isPretest = entry.is_pretest as boolean;
    delete entry.is_pretest;
    (isPretest ? pretests : tests).push(entry);
  }
  return { pretests, tests };
}

function buildInit(
  data: ProblemData,
  { pretests, tests }: { pretests: InitCase[]; tests: InitCase[] },
): InitCase {
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
  return init;
}

/** Port of legacy `ProblemDataCompiler.make_init`: null yaml when there is nothing to write; `cases` are the normalised rows to store back. */
export function compileInitYaml(
  data: ProblemData,
  archiveEntries: ReadonlySet<string>,
): CompiledInit {
  const cases = data.cases.map((testCase) => ({ ...testCase }));
  if (!cases.length) return { yaml: null, cases };
  const topLevel = groupCases(cases, {
    hasGenerator: Boolean(data.generator),
    archiveEntries,
  });
  return {
    yaml: emitYaml(buildInit(data, splitPretestsAndDropMarker(topLevel))),
    cases,
  };
}
