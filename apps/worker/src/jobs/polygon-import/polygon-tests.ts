import { EMPTY_TEST_CASE, PROBLEM_LIMITS } from '@libs/database';
import type { JsonObject, ProblemTestCase } from '@libs/database';
import { PolygonImportError } from './polygon-import.error';
import { shown } from './polygon-package';
import { childOf, childrenOf, childText, descendant } from './polygon-xml';
import type { XmlElement } from './polygon-xml';

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

/** problem.xml is untrusted: bounds keep the dependency closure and the output finite; the case bound is the requester's `maxCases`, and real problems have far fewer groups. */
const MAX_GROUPS = 1000;
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
  casePoints: number[];
  /** Tests outside any known group, in file order. */
  ungroupedCases: number[];
}
interface PlannedRows {
  batches: Group[];
  normalCases: number[];
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

function readTestNodes(testset: XmlElement, maxCases: number): XmlElement[] {
  const testNodes = childrenOf(childOf(testset, 'tests') ?? testset, 'test');
  if (!testNodes.length) throw new PolygonImportError('no testcases found');
  if (testNodes.length > maxCases)
    throw new PolygonImportError('too many testcases');
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

/** Names the repacked files, reads each test's points and adds every grouped test to its group's `cases`. */
function numberTests(
  testNodes: XmlElement[],
  patterns: PathPatterns,
  groups: Map<string, Group>,
): NumberedTests {
  const numbered: NumberedTests = {
    tests: [],
    casePoints: [],
    ungroupedCases: [],
  };
  testNodes.forEach((test, index) => {
    numbered.tests.push(plannedTest(index, patterns));
    numbered.casePoints.push(pointsOf(test, `points of test ${index + 1}`));
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

/** Complete-group groups as batches over their dependency closure; the S and E rows count against `maxCases` too. */
function expandBatches(groups: Map<string, Group>, maxCases: number): Group[] {
  let plannedRows = 0;
  return [...groups.values()]
    .filter((group) => group.policy === 'complete-group')
    .map((group) => {
      const cases = groupClosure(group, groups);
      plannedRows += cases.length + 2;
      if (plannedRows > maxCases)
        throw new PolygonImportError(
          `expanded batch rows exceed the limit of ${maxCases}`,
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
  { batches, normalCases }: PlannedRows,
  casePoints: number[],
): { batches: Group[]; casePoints: number[] } {
  const allPoints = [
    ...batches.map((batch) => batch.points),
    ...normalCases.map((index) => casePoints[index]),
  ];
  if (allPoints.every((points) => Number.isInteger(points)))
    return { batches, casePoints };
  const divisor = allPoints.map(toThousandths).reduce(gcd, 0) || 1;
  const scale = (points: number) => toThousandths(points) / divisor;
  return {
    batches: batches.map((batch) => ({
      ...batch,
      points: scale(batch.points),
    })),
    casePoints: casePoints.map(scale),
  };
}

const totalPoints = (
  { batches, normalCases }: PlannedRows,
  casePoints: number[],
) =>
  batches.reduce((sum, batch) => sum + batch.points, 0) +
  normalCases.reduce((sum, index) => sum + casePoints[index], 0);

function dropZeroPointRows(
  { batches, normalCases }: PlannedRows,
  casePoints: number[],
  options: TestPlanOptions,
): PlannedRows {
  return {
    batches: options.ignoreZeroPointBatches
      ? batches.filter((batch) => batch.points > 0)
      : batches,
    normalCases: options.ignoreZeroPointCases
      ? normalCases.filter((index) => casePoints[index] > 0)
      : normalCases,
  };
}

/** S/E-wrapped batches first, then plain cases in test order; a problem scoring nothing gives its last scoring row one point (legacy). */
function buildCaseRows(
  { batches, normalCases }: PlannedRows,
  { tests, casePoints }: Pick<NumberedTests, 'tests' | 'casePoints'>,
  isPartial: boolean,
): ProblemTestCase[] {
  const cases: ProblemTestCase[] = [];
  let lastScored: ProblemTestCase | null = null;
  for (const batch of batches) {
    if (!batch.cases.length) continue;
    lastScored = row({ type: 'S', points: batch.points });
    cases.push(lastScored);
    for (const index of batch.cases)
      cases.push(
        row({ input: tests[index].inputName, output: tests[index].outputName }),
      );
    cases.push(row({ type: 'E' }));
  }
  for (const index of [...normalCases].sort((left, right) => left - right)) {
    lastScored = row({
      input: tests[index].inputName,
      output: tests[index].outputName,
      points: casePoints[index],
    });
    cases.push(lastScored);
  }
  if (!isPartial && lastScored) lastScored.points = 1;
  return cases;
}

function fileIoArgs(judging: XmlElement | null): JsonObject | null {
  const inputFile = judging?.attributes['input-file'] ?? '';
  const outputFile = judging?.attributes['output-file'] ?? '';
  return inputFile && outputFile
    ? {
        io_method: 'file',
        io_input_file: inputFile,
        io_output_file: outputFile,
      }
    : null;
}

/** Polygon gives milliseconds and bytes; problems store seconds and KiB, clamped to the editor's limits. */
function readJudgingLimits(
  root: XmlElement,
  testset: XmlElement,
): Pick<TestPlan, 'timeLimit' | 'memoryLimit' | 'graderArgs'> {
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
  return {
    timeLimit: clamp(timeLimitMs / MS_PER_SECOND, PROBLEM_LIMITS.timeLimit),
    memoryLimit: clamp(
      Math.floor(memoryLimitBytes / BYTES_PER_KIB),
      PROBLEM_LIMITS.memoryLimit,
    ),
    graderArgs: fileIoArgs(descendant(root, 'judging')),
  };
}

/** Legacy `parse_tests`: complete-group groups become batches (a batch also runs every test of the groups it depends on; the judge caches results), each-test groups become plain cases, fractional points are scaled to integers, and a problem scoring nothing gives its last case one point. */
export function planTests(
  root: XmlElement,
  options: TestPlanOptions,
): TestPlan {
  const testset = findTestset(root);
  const testNodes = readTestNodes(testset, options.maxCases);
  const patterns = readPathPatterns(testset);
  const groups = parseGroups(testset);
  const numbered = numberTests(testNodes, patterns, groups);
  const planned: PlannedRows = {
    batches: expandBatches(groups, options.maxCases),
    normalCases: [...numbered.ungroupedCases, ...eachTestCases(groups)],
  };
  const scaled = scaleToIntegerPoints(planned, numbered.casePoints);
  const scaledRows = { ...planned, batches: scaled.batches };
  const isPartial = totalPoints(scaledRows, scaled.casePoints) !== 0;
  const kept = isPartial
    ? dropZeroPointRows(scaledRows, scaled.casePoints, options)
    : scaledRows;
  const cases = buildCaseRows(
    kept,
    { tests: numbered.tests, casePoints: scaled.casePoints },
    isPartial,
  );
  // Limits are read last, as before: a package with several faults reports the same one first.
  return {
    ...readJudgingLimits(root, testset),
    partial: isPartial,
    tests: numbered.tests,
    cases,
  };
}
