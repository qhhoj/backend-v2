import { EMPTY_TEST_CASE, PROBLEM_LIMITS } from '@libs/database';
import type { JsonObject, ProblemTestCase } from '@libs/database';
import { pointsArePercent } from './polygon-assets';
import { PolygonImportError } from './polygon-import.error';
import { shown } from './polygon-package';
import { childOf, childrenOf, childText, descendant } from '@libs/problems';
import type { XmlElement } from '@libs/problems';

export interface PlannedTest {
  index: number;
  inputPath: string;
  answerPath: string;
  inputName: string;
  outputName: string;
}
export interface TestPlan {
  timeLimit: number;
  memoryLimit: number;
  /** The limits as Polygon gives them (seconds, KiB) before the editor's clamp. */
  givenLimits: { timeLimit: number; memoryLimit: number };
  partial: boolean;
  tests: PlannedTest[];
  cases: ProblemTestCase[];
  graderArgs: JsonObject | null;
}
export interface TestPlanOptions {
  ignoreZeroPointBatches: boolean;
  ignoreZeroPointCases: boolean;
  /** The requester's testcase limit (the editor's rule), authorised by the api. */
  maxCases: number;
}
interface Group {
  name: string;
  points: number;
  policy: string;
  dependencies: string[];
  cases: number[];
}

/** problem.xml is untrusted: bounds keep the dependency closure and the output finite; the distinct-test bound is the requester's `maxCases`, and real problems have far fewer groups. */
const MAX_GROUPS = 1000;
/** Judged cases once batches copy their dependencies' tests: the bridge's per-submission case limit (`MAX_SUBMISSION_CASES`). */
const MAX_JUDGED_CASES = 10_000;
const MAX_POINTS = 1_000_000;
const MAX_PATTERN_WIDTH = 9;
const POINT_PRECISION = 1000;

const row = (overrides: Partial<ProblemTestCase>): ProblemTestCase => ({
  ...EMPTY_TEST_CASE,
  ...overrides,
});

const PATH_PATTERN = /%(0?)(\d*)d/;
/** Polygon's `%02d` path patterns. */
export const formatPathPattern = (pattern: string, index: number): string => {
  if (!PATH_PATTERN.test(pattern))
    throw new PolygonImportError('path pattern has no %d');
  return pattern.replace(
    PATH_PATTERN,
    (_match, zero: string, width: string) => {
      if (Number(width) > MAX_PATTERN_WIDTH)
        throw new PolygonImportError('path pattern is too wide');
      return String(index).padStart(Number(width || 0), zero ? '0' : ' ');
    },
  );
};
const clamp = (value: number, { min, max }: { min: number; max: number }) =>
  Math.min(max, Math.max(min, value));
const gcd = (left: number, right: number): number => {
  let [high, low] = [left, right];
  while (low !== 0) [high, low] = [low, high % low];
  return high;
};
const finiteNumber = (
  value: string | null | undefined,
  what: string,
  max: number,
): number => {
  const number =
    value === null || value === undefined || value.trim() === ''
      ? NaN
      : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > max)
    throw new PolygonImportError(`invalid ${what}`);
  return number;
};
const pointsOf = (element: XmlElement, what: string): number =>
  element.attributes.points === undefined
    ? 0
    : finiteNumber(element.attributes.points, what, MAX_POINTS);

const MS_PER_SECOND = 1000;
const BYTES_PER_KIB = 1024;

interface PathPatterns {
  input: string;
  answer: string;
}
interface NumberedTests {
  tests: PlannedTest[];
  /** Points as written in the package, by test index; may be fractional. */
  declaredCasePoints: number[];
  /** Tests outside any known group, in file order. */
  ungroupedCases: number[];
}
interface PlannedRows {
  batches: Group[];
  plainCases: number[];
}
/** One scoring unit of the case table: a plain case, or a batch with its S and E rows; `rows[0]` carries the points. */
interface RowBlock {
  points: number;
  rows: ProblemTestCase[];
}
export interface FileIoNames {
  inputFile: string;
  outputFile: string;
}

function findTestset(root: XmlElement): XmlElement {
  const testset = descendant(
    root,
    'testset',
    (candidate) => candidate.attributes.name === 'tests',
  );
  if (!testset) throw new PolygonImportError('testset tests not found');
  return testset;
}

const testElementsOf = (testset: XmlElement): XmlElement[] =>
  childrenOf(childOf(testset, 'tests') ?? testset, 'test');

/** The `<test>` elements of the `tests` testset, in file order (test N of the plan is element N-1). */
export const testNodesOf = (root: XmlElement): XmlElement[] =>
  testElementsOf(findTestset(root));

function readTestNodes(testset: XmlElement, maxCases: number): XmlElement[] {
  const testNodes = testElementsOf(testset);
  if (!testNodes.length) throw new PolygonImportError('no testcases found');
  if (testNodes.length > maxCases)
    throw new PolygonImportError(
      `too many testcases: ${testNodes.length}, the limit is ${maxCases}`,
      'too_many_testcases',
      { count: testNodes.length, limit: maxCases },
    );
  return testNodes;
}

function readPathPatterns(testset: XmlElement): PathPatterns {
  const input = childText(testset, 'input-path-pattern');
  const answer = childText(testset, 'answer-path-pattern');
  if (!input || !answer)
    throw new PolygonImportError('input/answer path patterns not found');
  return { input, answer };
}

function parseDependencies(group: XmlElement): string[] {
  return childrenOf(childOf(group, 'dependencies') ?? group, 'dependency').map(
    (dependency) => {
      const dependsOn = dependency.attributes.group;
      if (!dependsOn)
        throw new PolygonImportError('dependency without a group');
      return dependsOn;
    },
  );
}

function parseGroup(node: XmlElement): Group {
  const name = node.attributes.name;
  if (!name) throw new PolygonImportError('group without a name');
  const policy = node.attributes['points-policy'];
  if (policy !== 'complete-group' && policy !== 'each-test')
    throw new PolygonImportError(
      `unknown points policy for group ${shown(name)}`,
    );
  const dependencies = parseDependencies(node);
  if (policy === 'each-test' && dependencies.length)
    throw new PolygonImportError(
      'dependencies are only supported for batches with complete-group point policy',
    );
  return {
    name,
    points: pointsOf(node, `points of group ${name}`),
    policy,
    dependencies,
    cases: [],
  };
}

function parseGroups(testset: XmlElement): Map<string, Group> {
  const groupNodes = childrenOf(childOf(testset, 'groups') ?? testset, 'group');
  if (groupNodes.length > MAX_GROUPS)
    throw new PolygonImportError('too many groups');
  const groups = new Map<string, Group>();
  for (const node of groupNodes) {
    const group = parseGroup(node);
    groups.set(group.name, group);
  }
  return groups;
}

const plannedTest = (index: number, patterns: PathPatterns): PlannedTest => {
  const number = index + 1;
  const label = String(number).padStart(2, '0');
  return {
    index,
    inputPath: formatPathPattern(patterns.input, number),
    answerPath: formatPathPattern(patterns.answer, number),
    inputName: `${label}.inp`,
    outputName: `${label}.out`,
  };
};

/** Names the repacked files, reads each test's points and adds every grouped test to its group's `cases`. Mutates `groups`: expandBatches and eachTestCases read those `cases`, so this must run before them. */
function assignTestsToGroups(
  testNodes: XmlElement[],
  patterns: PathPatterns,
  groups: Map<string, Group>,
): NumberedTests {
  const numbered: NumberedTests = {
    tests: [],
    declaredCasePoints: [],
    ungroupedCases: [],
  };
  testNodes.forEach((test, index) => {
    numbered.tests.push(plannedTest(index, patterns));
    numbered.declaredCasePoints.push(
      pointsOf(test, `points of test ${index + 1}`),
    );
    const group =
      test.attributes.group === undefined
        ? undefined
        : groups.get(test.attributes.group);
    if (group) group.cases.push(index);
    else numbered.ungroupedCases.push(index);
  });
  return numbered;
}

/** Transitive dependencies, iterative; Polygon guarantees no cycles and `seen` keeps a bad package finite. */
function groupClosure(group: Group, groups: Map<string, Group>): number[] {
  const cases = new Set(group.cases);
  const seen = new Set([group.name]);
  const pending = [...group.dependencies];
  while (pending.length) {
    const name = pending.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const dependency = groups.get(name);
    if (!dependency)
      throw new PolygonImportError(`unknown dependency group ${shown(name)}`);
    dependency.cases.forEach((index) => cases.add(index));
    for (const dependsOn of dependency.dependencies) pending.push(dependsOn);
  }
  return [...cases].sort((left, right) => left - right);
}

/** Complete-group groups as batches over their dependency closure. `maxCases` bounds distinct tests (readTestNodes); the copies only count against the judge's case limit, on top of the `plainCaseCount` plain cases. */
function expandBatches(
  groups: Map<string, Group>,
  plainCaseCount: number,
): Group[] {
  let judgedCases = plainCaseCount;
  return [...groups.values()]
    .filter((group) => group.policy === 'complete-group')
    .map((group) => {
      const cases = groupClosure(group, groups);
      judgedCases += cases.length;
      if (judgedCases > MAX_JUDGED_CASES)
        throw new PolygonImportError(
          `batches with their dependencies expand to more than ${MAX_JUDGED_CASES} judged cases`,
        );
      return { ...group, cases };
    });
}

const eachTestCases = (groups: Map<string, Group>): number[] =>
  [...groups.values()]
    .filter((group) => group.policy === 'each-test')
    .flatMap((group) => group.cases);

const toThousandths = (points: number) => Math.round(points * POINT_PRECISION);

/** Fractional points become integers sharing one divisor (gcd of all points in thousandths), so their ratios hold. Batch members carry no points in the rows, so scaling every case entry is safe. */
function scaleToIntegerPoints(
  { batches, plainCases }: PlannedRows,
  declaredCasePoints: number[],
): { batches: Group[]; integerCasePoints: number[]; rescaled: boolean } {
  const allPoints = [
    ...batches.map((batch) => batch.points),
    ...plainCases.map((index) => declaredCasePoints[index]),
  ];
  if (allPoints.every((points) => Number.isInteger(points)))
    return { batches, integerCasePoints: declaredCasePoints, rescaled: false };
  const divisor = allPoints.map(toThousandths).reduce(gcd, 0) || 1;
  const scale = (points: number) => toThousandths(points) / divisor;
  return {
    batches: batches.map((batch) => ({
      ...batch,
      points: scale(batch.points),
    })),
    integerCasePoints: declaredCasePoints.map(scale),
    rescaled: true,
  };
}

/** A testlib checker's or interactor's `quitp(x)` is x points of the test, which the judge reads against the rescaled points. testlib's std:: checkers never award partial points and the percent flag makes x relative, so only a custom checker or an interactor without it is refused. */
function refuseRescaledCheckerPoints(root: XmlElement): void {
  const checker = descendant(root, 'checker');
  const customChecker =
    checker && !checker.attributes.name?.startsWith('std::');
  const readsPoints = customChecker || descendant(root, 'interactor');
  if (!readsPoints || pointsArePercent(root)) return;
  throw new PolygonImportError(
    'fractional points with a custom checker or an interactor: QHHOJ scales points to integers, so partial points from them would be misread; use integer points or enable "treat points from checker as percent"',
  );
}

const totalPoints = (
  { batches, plainCases }: PlannedRows,
  casePoints: number[],
) =>
  batches.reduce((sum, batch) => sum + batch.points, 0) +
  plainCases.reduce((sum, index) => sum + casePoints[index], 0);

function dropZeroPointRows(
  { batches, plainCases }: PlannedRows,
  casePoints: number[],
  options: TestPlanOptions,
): PlannedRows {
  return {
    batches: options.ignoreZeroPointBatches
      ? batches.filter((batch) => batch.points > 0)
      : batches,
    plainCases: options.ignoreZeroPointCases
      ? plainCases.filter((index) => casePoints[index] > 0)
      : plainCases,
  };
}

const batchBlock = (batch: Group, tests: PlannedTest[]): RowBlock => ({
  points: batch.points,
  rows: [
    row({ type: 'S', points: batch.points }),
    ...batch.cases.map((index) =>
      row({ input: tests[index].inputName, output: tests[index].outputName }),
    ),
    row({ type: 'E' }),
  ],
});

const caseBlock = (
  index: number,
  { tests, casePoints }: { tests: PlannedTest[]; casePoints: number[] },
): RowBlock => ({
  points: casePoints[index],
  rows: [
    row({
      input: tests[index].inputName,
      output: tests[index].outputName,
      points: casePoints[index],
    }),
  ],
});

/** S/E-wrapped batches, then plain cases in test order; every 0-point block goes after all scoring ones, because the judge stops at a failed 0-point case. A problem scoring nothing gives its last block one point (legacy). */
function buildCaseRows(
  { batches, plainCases }: PlannedRows,
  scoring: { tests: PlannedTest[]; casePoints: number[] },
  isPartial: boolean,
): ProblemTestCase[] {
  const blocks = [
    ...batches
      .filter((batch) => batch.cases.length)
      .map((batch) => batchBlock(batch, scoring.tests)),
    ...[...plainCases]
      .sort((left, right) => left - right)
      .map((index) => caseBlock(index, scoring)),
  ];
  const ordered = [
    ...blocks.filter((block) => block.points > 0),
    ...blocks.filter((block) => block.points === 0),
  ];
  const lastBlock = ordered.at(-1);
  if (!isPartial && lastBlock) lastBlock.rows[0].points = 1;
  return ordered.flatMap((block) => block.rows);
}

/** Polygon's `input-file`/`output-file`, empty for stdin/stdout. The judge redirects both files or neither, so a package naming only one is refused. */
export function fileIoNamesOf(root: XmlElement): FileIoNames {
  const judging = descendant(root, 'judging');
  const inputFile = judging?.attributes['input-file'] ?? '';
  const outputFile = judging?.attributes['output-file'] ?? '';
  if (Boolean(inputFile) !== Boolean(outputFile))
    throw new PolygonImportError(
      `Polygon sets only the ${inputFile ? `input file ${shown(inputFile)}` : `output file ${shown(outputFile)}`}; QHHOJ needs both I/O files or neither`,
    );
  return { inputFile, outputFile };
}

const fileIoArgs = ({
  inputFile,
  outputFile,
}: FileIoNames): JsonObject | null =>
  inputFile
    ? {
        io_method: 'file',
        io_input_file: inputFile,
        io_output_file: outputFile,
      }
    : null;

/** Polygon gives milliseconds and bytes; problems store seconds and KiB, clamped to the editor's limits. */
function readLimitsAndGraderArgs(
  root: XmlElement,
  testset: XmlElement,
): Pick<TestPlan, 'timeLimit' | 'memoryLimit' | 'givenLimits' | 'graderArgs'> {
  const timeLimitMs = finiteNumber(
    childText(testset, 'time-limit'),
    'time limit',
    Number.MAX_SAFE_INTEGER,
  );
  const memoryLimitBytes = finiteNumber(
    childText(testset, 'memory-limit'),
    'memory limit',
    Number.MAX_SAFE_INTEGER,
  );
  const given = {
    timeLimit: timeLimitMs / MS_PER_SECOND,
    memoryLimit: Math.floor(memoryLimitBytes / BYTES_PER_KIB),
  };
  return {
    timeLimit: clamp(given.timeLimit, PROBLEM_LIMITS.timeLimit),
    memoryLimit: clamp(given.memoryLimit, PROBLEM_LIMITS.memoryLimit),
    givenLimits: given,
    graderArgs: fileIoArgs(fileIoNamesOf(root)),
  };
}

/** Legacy `parse_tests`: complete-group groups become batches (a batch also runs every test of the groups it depends on), each-test groups become plain cases, 0-point rows go last, fractional points are scaled to integers (refused for a custom checker that may award absolute partial points), and a problem scoring nothing gives its last case one point. */
export function planTests(
  root: XmlElement,
  options: TestPlanOptions,
): TestPlan {
  const testset = findTestset(root);
  const testNodes = readTestNodes(testset, options.maxCases);
  const patterns = readPathPatterns(testset);
  const groups = parseGroups(testset);
  const numbered = assignTestsToGroups(testNodes, patterns, groups);
  const plainCases = [...numbered.ungroupedCases, ...eachTestCases(groups)];
  const rowsBeforeScaling: PlannedRows = {
    batches: expandBatches(groups, plainCases.length),
    plainCases,
  };
  const scaled = scaleToIntegerPoints(
    rowsBeforeScaling,
    numbered.declaredCasePoints,
  );
  if (scaled.rescaled) refuseRescaledCheckerPoints(root);
  const scoredRows = { ...rowsBeforeScaling, batches: scaled.batches };
  const isPartial = totalPoints(scoredRows, scaled.integerCasePoints) !== 0;
  const rowsToEmit = isPartial
    ? dropZeroPointRows(scoredRows, scaled.integerCasePoints, options)
    : scoredRows;
  const cases = buildCaseRows(
    rowsToEmit,
    { tests: numbered.tests, casePoints: scaled.integerCasePoints },
    isPartial,
  );
  // Limits are read last, as before: a package with several faults reports the same one first.
  return {
    ...readLimitsAndGraderArgs(root, testset),
    partial: isPartial,
    tests: numbered.tests,
    cases,
  };
}
