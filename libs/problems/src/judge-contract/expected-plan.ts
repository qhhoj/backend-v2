import type { JsonObject, ProblemTestCase } from '@libs/database';

/**
 * The cases a judge must grade for stored rows, under DMOJ's plan rules: a pretest run grades only the pretests
 * (when there are any); a full run grades the pretests first (a plain pretest is worth 0), then the tests. Each
 * case takes its own checker and limits, else its batch's, else the problem's. Written beside each init.yml so the
 * judge can compare its planner's reading of the file with what the rows mean.
 */
export interface CheckerJson {
  name: string;
  args: JsonObject;
}
export interface ProblemDefaults {
  checker: CheckerJson;
  outputLimit: number | null;
  outputPrefix: number | null;
}
interface Overrides {
  checker: CheckerJson | null;
  outputLimit: number | null;
  outputPrefix: number | null;
}
interface PlannedCase {
  in: string;
  out: string;
  total: number;
  batch: number | null;
  checker: CheckerJson;
  outputLimit: number | null;
  outputPrefix: number | null;
}
interface Unit extends Overrides {
  points: number;
  isPretest: boolean;
  batch: boolean;
  cases: (Overrides & { in: string; out: string })[];
}
export interface ExpectedPlan {
  pretested: boolean;
  cases: PlannedCase[];
}

const NO_OVERRIDES: Overrides = {
  checker: null,
  outputLimit: null,
  outputPrefix: null,
};

const overridesOf = (row: ProblemTestCase): Overrides => ({
  checker: row.checker
    ? { name: row.checker, args: row.checkerArgs ?? {} }
    : null,
  outputLimit: row.outputLimit,
  outputPrefix: row.outputPrefix,
});

/** Rows grouped into units: a batch with its cases, or a plain case alone. */
function unitsOf(rows: ProblemTestCase[]): Unit[] {
  const units: Unit[] = [];
  let open: Unit | null = null;
  for (const row of rows) {
    const own = overridesOf(row);
    const base = { points: row.points ?? 0, isPretest: row.isPretest };
    if (row.type === 'S') {
      open = { ...base, batch: true, ...own, cases: [] };
      units.push(open);
    } else if (row.type === 'E') open = null;
    else if (open) open.cases.push({ in: row.input, out: row.output, ...own });
    else
      units.push({
        ...base,
        batch: false,
        ...NO_OVERRIDES,
        cases: [{ in: row.input, out: row.output, ...own }],
      });
  }
  return units;
}

function casesOf(
  unit: Unit,
  batch: number | null,
  zeroPoints: boolean,
  problem: ProblemDefaults,
): PlannedCase[] {
  return unit.cases.map((own) => ({
    in: own.in,
    out: own.out,
    total: zeroPoints ? 0 : unit.points,
    batch,
    checker: own.checker ?? unit.checker ?? problem.checker,
    outputLimit: own.outputLimit ?? unit.outputLimit ?? problem.outputLimit,
    outputPrefix: own.outputPrefix ?? unit.outputPrefix ?? problem.outputPrefix,
  }));
}

export function expectedPlan(
  rows: ProblemTestCase[],
  problem: ProblemDefaults,
  pretestsOnly: boolean,
): ExpectedPlan {
  const units = unitsOf(rows);
  const pretests = units.filter((unit) => unit.isPretest);
  const pretested = pretestsOnly && pretests.length > 0;
  const passes: [Unit[], boolean][] = pretested
    ? [[pretests, false]]
    : [
        [pretests, true],
        [units.filter((unit) => !unit.isPretest), false],
      ];
  const cases: PlannedCase[] = [];
  let batches = 0;
  for (const [list, fullRunPretest] of passes)
    for (const unit of list) {
      if (unit.batch) batches += 1;
      const zeroPoints = !unit.batch && fullRunPretest;
      cases.push(
        ...casesOf(unit, unit.batch ? batches : null, zeroPoints, problem),
      );
    }
  return { pretested, cases };
}
