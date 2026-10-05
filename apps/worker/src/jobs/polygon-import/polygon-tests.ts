import { EMPTY_TEST_CASE, PROBLEM_LIMITS } from '@libs/database';
import type { JsonObject, ProblemTestCase } from '@libs/database';
import { PolygonImportError } from './polygon-import.error';
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
}
interface Group {
  name: string;
  points: number;
  policy: string;
  dependencies: string[];
  cases: number[];
}

/** problem.xml is untrusted: bounds keep the dependency closure and the output finite. Cases mirror the api's highest per-problem limit (`MAX_TESTCASES_MASS`); real problems have far fewer groups. */
const MAX_PLANNED_CASES = 9999;
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

/** Legacy `parse_tests`: complete-group groups become batches (a batch also runs every test of the groups it depends on; the judge caches results), each-test groups become plain cases, fractional points are scaled to integers, and a problem scoring nothing gives its last case one point. */
export function planTests(
  root: XmlElement,
  options: TestPlanOptions,
): TestPlan {
  const testset = descendant(
    root,
    'testset',
    (candidate) => candidate.attributes.name === 'tests',
  );
  if (!testset) throw new PolygonImportError('testset tests not found');
  const testNodes = childrenOf(childOf(testset, 'tests') ?? testset, 'test');
  if (!testNodes.length) throw new PolygonImportError('no testcases found');
  if (testNodes.length > MAX_PLANNED_CASES)
    throw new PolygonImportError('too many testcases');
  const inputPattern = childText(testset, 'input-path-pattern');
  const answerPattern = childText(testset, 'answer-path-pattern');
  if (!inputPattern || !answerPattern)
    throw new PolygonImportError('input/answer path patterns not found');

  const groupNodes = childrenOf(childOf(testset, 'groups') ?? testset, 'group');
  if (groupNodes.length > MAX_GROUPS)
    throw new PolygonImportError('too many groups');
  const groups = new Map<string, Group>();
  for (const group of groupNodes) {
    const name = group.attributes.name;
    if (!name) throw new PolygonImportError('group without a name');
    const policy = group.attributes['points-policy'];
    if (policy !== 'complete-group' && policy !== 'each-test')
      throw new PolygonImportError(`unknown points policy for group ${name}`);
    const dependencies = childrenOf(
      childOf(group, 'dependencies') ?? group,
      'dependency',
    ).map((dependency) => {
      const dependsOn = dependency.attributes.group;
      if (!dependsOn)
        throw new PolygonImportError('dependency without a group');
      return dependsOn;
    });
    if (policy === 'each-test' && dependencies.length)
      throw new PolygonImportError(
        'dependencies are only supported for batches with complete-group point policy',
      );
    groups.set(name, {
      name,
      points: pointsOf(group, `points of group ${name}`),
      policy,
      dependencies,
      cases: [],
    });
  }

  const tests: PlannedTest[] = [];
  const casePoints: number[] = [];
  let normalCases: number[] = [];
  testNodes.forEach((test, index) => {
    const number = index + 1;
    const label = String(number).padStart(2, '0');
    tests.push({
      index,
      inputPath: formatPathPattern(inputPattern, number),
      answerPath: formatPathPattern(answerPattern, number),
      inputName: `${label}.inp`,
      outputName: `${label}.out`,
    });
    casePoints.push(pointsOf(test, `points of test ${number}`));
    const group =
      test.attributes.group === undefined
        ? undefined
        : groups.get(test.attributes.group);
    if (group) group.cases.push(index);
    else normalCases.push(index);
  });

  /** Transitive dependencies, iterative; Polygon guarantees no cycles and `seen` keeps a bad package finite. */
  const closure = (group: Group): number[] => {
    const cases = new Set(group.cases);
    const seen = new Set([group.name]);
    const pending = [...group.dependencies];
    while (pending.length) {
      const name = pending.pop()!;
      if (seen.has(name)) continue;
      seen.add(name);
      const dependency = groups.get(name);
      if (!dependency)
        throw new PolygonImportError(`unknown dependency group ${name}`);
      dependency.cases.forEach((index) => cases.add(index));
      for (const name of dependency.dependencies) pending.push(name);
    }
    return [...cases].sort((left, right) => left - right);
  };
  let plannedRows = 0;
  let batches = [...groups.values()]
    .filter((group) => group.policy === 'complete-group')
    .map((group) => {
      const cases = closure(group);
      plannedRows += cases.length + 2;
      if (plannedRows > MAX_PLANNED_CASES)
        throw new PolygonImportError('too many testcases');
      return { ...group, cases };
    });
  for (const group of groups.values())
    if (group.policy === 'each-test') normalCases.push(...group.cases);

  const allPoints = [
    ...batches.map((batch) => batch.points),
    ...normalCases.map((index) => casePoints[index]),
  ];
  if (allPoints.some((points) => !Number.isInteger(points))) {
    const divisor =
      allPoints
        .map((points) => Math.round(points * POINT_PRECISION))
        .reduce(gcd, 0) || 1;
    const scale = (points: number) =>
      Math.round(points * POINT_PRECISION) / divisor;
    batches.forEach((batch) => (batch.points = scale(batch.points)));
    normalCases.forEach(
      (index) => (casePoints[index] = scale(casePoints[index])),
    );
  }
  const total =
    batches.reduce((sum, batch) => sum + batch.points, 0) +
    normalCases.reduce((sum, index) => sum + casePoints[index], 0);
  const partial = total !== 0;
  if (partial) {
    if (options.ignoreZeroPointBatches)
      batches = batches.filter((batch) => batch.points > 0);
    if (options.ignoreZeroPointCases)
      normalCases = normalCases.filter((index) => casePoints[index] > 0);
  }
  normalCases.sort((left, right) => left - right);

  const cases: ProblemTestCase[] = [];
  let last: ProblemTestCase | null = null;
  for (const batch of batches) {
    if (!batch.cases.length) continue;
    last = row({ type: 'S', points: batch.points });
    cases.push(last);
    for (const index of batch.cases)
      cases.push(
        row({ input: tests[index].inputName, output: tests[index].outputName }),
      );
    cases.push(row({ type: 'E' }));
  }
  for (const index of normalCases) {
    last = row({
      input: tests[index].inputName,
      output: tests[index].outputName,
      points: casePoints[index],
    });
    cases.push(last);
  }
  if (!partial && last) last.points = 1;

  const judging = descendant(root, 'judging');
  const inputFile = judging?.attributes['input-file'] ?? '';
  const outputFile = judging?.attributes['output-file'] ?? '';
  return {
    timeLimit: clamp(
      finiteNumber(
        childText(testset, 'time-limit'),
        'time limit',
        Number.MAX_SAFE_INTEGER,
      ) / 1000,
      PROBLEM_LIMITS.timeLimit,
    ),
    memoryLimit: clamp(
      Math.floor(
        finiteNumber(
          childText(testset, 'memory-limit'),
          'memory limit',
          Number.MAX_SAFE_INTEGER,
        ) / 1024,
      ),
      PROBLEM_LIMITS.memoryLimit,
    ),
    partial,
    tests,
    cases,
    graderArgs:
      inputFile && outputFile
        ? {
            io_method: 'file',
            io_input_file: inputFile,
            io_output_file: outputFile,
          }
        : null,
  };
}
