// Pure row classification for the migration gate (no I/O). A row is one submission of a snapshot
// (see gate-snapshot.mjs). `classify(control, candidate)` sorts every submission into
// unchanged / improved / worsened / other, so only worsened rows stop a flip.

/** Tolerance for float comparisons (points, seconds). */
const POINT_EPSILON = 1e-9;
/** Times are seconds (as stored). A case time differs when it moves by more than both thresholds. */
export const DEFAULT_NOISE = { relative: 0.1, absoluteSeconds: 0.02 };
/** A case slows down when its time grows by at least this factor and these seconds, status unchanged. */
export const DEFAULT_SLOWDOWN = { slowdownFactor: 2, slowdownSeconds: 0.2 };
/** Verdicts that mean "the run did not grade the code": a change to or from them is never an improvement. */
const UNGRADED = new Set(['CE', 'IE', null, undefined]);
/** Tokens of the exploit audit; the tool proposes, the operator decides. */
const EXPLOIT_PATTERN =
  /\b(?:pread|lseek|fseek|freopen|extern)\b|\/proc\/self|(?<![A-Za-z0-9])_exit\b/g;
const CATCH_PATTERN = /\bcatch\b/;
/** Worst first: a row takes the worst direction among its fields. */
const SEVERITY = ['worsened', 'other', 'improved', 'unchanged'];

const worst = (directions) =>
  SEVERITY.find((direction) => directions.includes(direction)) ?? 'unchanged';

const sign = (delta) =>
  Math.abs(delta) <= POINT_EPSILON ? 0 : delta > 0 ? 1 : -1;

const asDirection = (value) =>
  value > 0 ? 'improved' : value < 0 ? 'worsened' : 'unchanged';

/** AC beats every other verdict; two different non-AC verdicts are not ordered. */
const verdictOrder = (before, after) =>
  (before === 'AC' ? 1 : 0) - (after === 'AC' ? 1 : 0);

/**
 * Direction of one (verdict, points) pair. Points decide first (more is better); a verdict change with equal
 * points is ordered AC over the rest; a conflict (points up, AC lost) and unordered changes are `other`.
 */
export function compareOutcome(before, after) {
  const sameVerdict = before.result === after.result;
  if (!sameVerdict && (UNGRADED.has(before.result) || UNGRADED.has(after.result))) {
    return 'other';
  }
  const byPoints = sign((after.points ?? 0) - (before.points ?? 0));
  const byVerdict = sameVerdict ? 0 : -verdictOrder(before.result, after.result);
  if (byPoints * byVerdict < 0) return 'other';
  if (byPoints !== 0) return asDirection(byPoints);
  if (byVerdict !== 0) return asDirection(byVerdict);
  return sameVerdict ? 'unchanged' : 'other';
}

const caseOutcome = (testCase) => ({
  result: testCase.status,
  points: testCase.points,
});

/** `{ direction, fields }` for the per-case differences of two rows with the same positions. */
function compareCases(before, after) {
  const afterByPosition = new Map(after.map((c) => [c.position, c]));
  const positions = new Set(before.map((c) => c.position));
  if (
    before.length !== after.length ||
    after.some((c) => !positions.has(c.position))
  ) {
    return {
      direction: 'other',
      fields: [`case count ${before.length} → ${after.length}`],
    };
  }
  const directions = [];
  const fields = [];
  for (const testCase of before) {
    const other = afterByPosition.get(testCase.position);
    const direction = compareOutcome(caseOutcome(testCase), caseOutcome(other));
    if (direction === 'unchanged') continue;
    directions.push(direction);
    fields.push(
      `case ${testCase.position} ${testCase.status}/${testCase.points} → ${other.status}/${other.points}`,
    );
  }
  return { direction: worst(directions), fields };
}

const movedBeyondNoise = (before, after, noise) =>
  Math.abs(after - before) >
  Math.max(noise.relative * Math.abs(before), noise.absoluteSeconds);

/** Cases with the same status whose time moved beyond the noise threshold. */
function timingChanges(before, after, noise) {
  const afterByPosition = new Map(after.map((c) => [c.position, c]));
  return before.filter((testCase) => {
    const other = afterByPosition.get(testCase.position);
    return (
      other &&
      other.status === testCase.status &&
      movedBeyondNoise(testCase.time ?? 0, other.time ?? 0, noise)
    );
  });
}

/** Cases with the same status that got markedly slower: time-limit headroom shrank. */
function slowdownCases(before, after, limits) {
  const afterByPosition = new Map(after.map((c) => [c.position, c]));
  return before.filter((testCase) => {
    const other = afterByPosition.get(testCase.position);
    if (!other || other.status !== testCase.status) return false;
    const was = testCase.time ?? 0;
    const now = other.time ?? 0;
    return now >= was * limits.slowdownFactor - POINT_EPSILON && now - was >= limits.slowdownSeconds - POINT_EPSILON;
  });
}

const isTle = (status) => status === 'TLE';

const flipsTle = (before, after) =>
  isTle(before.result) !== isTle(after.result) ||
  before.cases.some(
    (testCase) =>
      isTle(testCase.status) !==
      isTle(after.cases.find((c) => c.position === testCase.position)?.status),
  );

/** Exploit-grep tokens and `catch` of a source (SPEC-private 5.4 (a)). */
export function sourceHints(source) {
  const text = source ?? '';
  return {
    exploit: [...new Set(text.match(EXPLOIT_PATTERN) ?? [])],
    catches: CATCH_PATTERN.test(text),
  };
}

function suggestion(hints, tleFlip) {
  if (hints.exploit.length > 0) return 'exploit';
  if (hints.catches) return 'read-catch';
  return tleFlip ? 'tle-flip' : null;
}

/** Row-level directions: verdict and points, case points, and a changed case total. */
function compareTotals(before, after) {
  const fields = [];
  const directions = [];
  const note = (name, a, b) => fields.push(`${name} ${a} → ${b}`);
  const outcome = compareOutcome(before, after);
  if (outcome !== 'unchanged') {
    directions.push(outcome);
    note('result/points', `${before.result}/${before.points}`, `${after.result}/${after.points}`);
  }
  const casePoints = compareOutcome(
    { result: 'AC', points: before.casePoints },
    { result: 'AC', points: after.casePoints },
  );
  if (casePoints !== 'unchanged') {
    directions.push(casePoints);
    note('casePoints', before.casePoints, after.casePoints);
  }
  if (before.caseTotal !== after.caseTotal) {
    directions.push('other');
    note('caseTotal', before.caseTotal, after.caseTotal);
  }
  return { directions, fields };
}

/** One submission present on both sides. */
export function classifyRow(before, after, options = {}) {
  const noise = { ...DEFAULT_NOISE, ...options };
  const limits = { ...DEFAULT_SLOWDOWN, ...options };
  const totals = compareTotals(before, after);
  const cases = compareCases(before.cases ?? [], after.cases ?? []);
  const direction = worst([...totals.directions, cases.direction]);
  const timing = timingChanges(before.cases ?? [], after.cases ?? [], noise);
  const tleFlip = flipsTle(
    { ...before, cases: before.cases ?? [] },
    { ...after, cases: after.cases ?? [] },
  );
  const hints = sourceHints(after.source ?? before.source);
  return {
    id: before.id,
    language: after.language ?? before.language,
    class: direction,
    fields: [...totals.fields, ...cases.fields],
    timingCases: timing.map((c) => c.position),
    slowdownCases: slowdownCases(before.cases ?? [], after.cases ?? [], limits).map((c) => c.position),
    tleFlip,
    hints,
    suggestion: direction === 'unchanged' ? null : suggestion(hints, tleFlip),
  };
}

const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

/**
 * Compares two snapshots' rows (`control` is the reference). Returns:
 * improved/worsened/other (row reports), unchanged (count), timingOnly (rows unchanged but for case times),
 * slowdowns (rows with a case at least slowdownFactor times and slowdownSeconds slower, also listed in their class),
 * tleFlips (rows where a TLE appeared or vanished, also listed in their class), missing (a row on one side only).
 */
export function classify(control, candidate, options = {}) {
  const candidateById = byId(candidate);
  const report = { improved: [], worsened: [], other: [], unchanged: 0, timingOnly: [], tleFlips: [], slowdowns: [], missing: [] };
  for (const before of control) {
    const after = candidateById.get(before.id);
    if (!after) {
      report.missing.push({ id: before.id, language: before.language, side: 'candidate' });
      continue;
    }
    const row = classifyRow(before, after, options);
    if (row.slowdownCases.length > 0) report.slowdowns.push(row);
    if (row.tleFlip) report.tleFlips.push(row);
    if (row.class !== 'unchanged') report[row.class].push(row);
    else if (row.timingCases.length > 0) report.timingOnly.push(row);
    else report.unchanged += 1;
  }
  const controlIds = byId(control);
  for (const after of candidate) {
    if (!controlIds.has(after.id)) {
      report.missing.push({ id: after.id, language: after.language, side: 'control' });
    }
  }
  return report;
}

/** Control (the unsplit local pass) against the stored production snapshot: the pre-existing differences. */
export const preExisting = (stored, control, options) =>
  classify(stored, control, options);
