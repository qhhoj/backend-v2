// run: node --test scripts/judge/parity/gate-classify.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, classifyRow, compareOutcome, preExisting, sourceHints } from './gate-classify.mjs';

const aCase = (overrides = {}) => ({ position: 1, status: 'AC', time: 1, memory: 1000, points: 10, total: 10, ...overrides });
const row = (overrides = {}) => ({
  id: 'r1', language: 'CPP17', result: 'AC', points: 10, casePoints: 10, caseTotal: 10,
  judgedDataVersion: 3, cases: [aCase()], source: 'int main(){}', ...overrides,
});
const wrong = { result: 'WA', points: 0, casePoints: 0, cases: [aCase({ status: 'WA', points: 0 })] };
const partial = { result: 'WA', points: 4, casePoints: 4, cases: [aCase({ status: 'WA', points: 4 })] };

test('verdict and points decide the direction', () => {
  const direction = (a, b) => compareOutcome(a, b);
  assert.equal(direction({ result: 'WA', points: 0 }, { result: 'AC', points: 10 }), 'improved');
  assert.equal(direction({ result: 'AC', points: 10 }, { result: 'WA', points: 0 }), 'worsened');
  assert.equal(direction({ result: 'WA', points: 4 }, { result: 'WA', points: 6 }), 'improved');
  assert.equal(direction({ result: 'WA', points: 6 }, { result: 'TLE', points: 4 }), 'worsened');
  assert.equal(direction({ result: 'WA', points: 4 }, { result: 'WA', points: 4 }), 'unchanged');
});

test('a verdict change with equal points follows the verdict order (AC over the rest)', () => {
  assert.equal(compareOutcome({ result: 'TLE', points: 0 }, { result: 'AC', points: 0 }), 'improved');
  assert.equal(compareOutcome({ result: 'AC', points: 0 }, { result: 'TLE', points: 0 }), 'worsened');
});

test('unordered or contradictory changes are other', () => {
  assert.equal(compareOutcome({ result: 'WA', points: 0 }, { result: 'RTE', points: 0 }), 'other');
  assert.equal(compareOutcome({ result: 'AC', points: 5 }, { result: 'TLE', points: 8 }), 'other');
  assert.equal(compareOutcome({ result: 'CE', points: 0 }, { result: 'IE', points: 0 }), 'other');
  assert.equal(compareOutcome({ result: 'WA', points: 0 }, { result: 'CE', points: 0 }), 'other');
  assert.equal(compareOutcome({ result: 'IE', points: null }, { result: 'AC', points: 10 }), 'other');
});

test('classify sorts rows into the four classes with totals', () => {
  const control = [row({ id: 'same' }), row({ id: 'up', ...wrong }), row({ id: 'down' }), row({ id: 'odd', ...wrong })];
  const candidate = [row({ id: 'same' }), row({ id: 'up' }), row({ id: 'down', ...wrong }), row({ id: 'odd', ...wrong, result: 'RTE', cases: [aCase({ status: 'RTE', points: 0 })] })];
  const report = classify(control, candidate);
  assert.equal(report.unchanged, 1);
  assert.deepEqual(report.improved.map((r) => r.id), ['up']);
  assert.deepEqual(report.worsened.map((r) => r.id), ['down']);
  assert.deepEqual(report.other.map((r) => r.id), ['odd']);
});

test('equal totals with different cases are still reported', () => {
  const swapped = [aCase({ position: 1, status: 'WA', points: 0 }), aCase({ position: 2, status: 'AC', points: 20 })];
  const original = [aCase({ position: 1, status: 'AC', points: 10 }), aCase({ position: 2, status: 'WA', points: 0 })];
  const result = classifyRow(row({ cases: original, points: 10 }), row({ cases: swapped, points: 10 }));
  assert.equal(result.class, 'worsened');
  assert.match(result.fields.join(), /case 1 AC\/10 → WA\/0/);
});

test('one worsened case outweighs an improved total; improved cases alone improve the row', () => {
  const before = row({ ...wrong, cases: [aCase({ status: 'WA', points: 0 }), aCase({ position: 2 })] });
  const mixed = row({ result: 'AC', points: 20, casePoints: 20, cases: [aCase(), aCase({ position: 2, status: 'TLE', points: 0 })] });
  assert.equal(classifyRow(before, mixed).class, 'worsened');
  const better = row({ cases: [aCase(), aCase({ position: 2 })] });
  assert.equal(classifyRow(before, better).class, 'improved');
});

test('a case-count change is other', () => {
  assert.equal(classifyRow(row(), row({ cases: [] })).class, 'other');
});

test('time moves count only beyond both thresholds, status unchanged', () => {
  const slow = (time) => row({ cases: [aCase({ time })] });
  const within = classify([slow(1)], [slow(1.05)]);
  assert.equal(within.unchanged, 1);
  const tinyJump = classify([slow(0.1)], [slow(0.115)]);
  assert.equal(tinyJump.unchanged, 1);
  const beyond = classify([slow(1)], [slow(1.5)]);
  assert.equal(beyond.timingOnly.length, 1);
  assert.equal(beyond.unchanged, 0);
  assert.equal(beyond.worsened.length, 0);
  const custom = classify([slow(1)], [slow(1.05)], { relative: 0.01, absoluteSeconds: 0.001 });
  assert.equal(custom.timingOnly.length, 1);
});

test('TLE flips are listed separately and keep their class', () => {
  const tle = row({ result: 'TLE', points: 0, casePoints: 0, cases: [aCase({ status: 'TLE', points: 0, time: 2 })] });
  const report = classify([row()], [tle]);
  assert.deepEqual(report.tleFlips.map((r) => r.id), ['r1']);
  assert.deepEqual(report.worsened.map((r) => r.id), ['r1']);
  assert.equal(classify([tle], [tle]).tleFlips.length, 0);
});

test('a row on one side only is listed as missing, never dropped', () => {
  const report = classify([row({ id: 'gone' })], [row({ id: 'new' })]);
  assert.deepEqual(report.missing.map((m) => [m.id, m.side]), [['gone', 'candidate'], ['new', 'control']]);
  assert.equal(report.unchanged, 0);
});

test('source hints propose exploit and catch rows; the tool only proposes', () => {
  assert.deepEqual(sourceHints('x = pread(0, b, 1, 0); int _exit_code;').exploit, ['pread']);
  assert.deepEqual(sourceHints('open("/proc/self/fd/0"); _exit(0); lseek(0,0,0);').exploit.sort(), ['/proc/self', '_exit', 'lseek']);
  assert.deepEqual(sourceHints('int quick_exit_flag; extern int g;').exploit, ['extern']);
  assert.deepEqual(sourceHints('no tricks here'), { exploit: [], catches: false });
  assert.equal(sourceHints('try { f(); } catch (...) {}').catches, true);
  const hit = classifyRow(row({ source: 'lseek(0,0,0)' }), row({ ...wrong, source: 'lseek(0,0,0)' }));
  assert.equal(hit.suggestion, 'exploit');
  const caught = classifyRow(row({ source: 'try{}catch(...){}' }), row({ ...wrong, source: 'try{}catch(...){}' }));
  assert.equal(caught.suggestion, 'read-catch');
  assert.equal(classifyRow(row(), row()).suggestion, null);
});

test('preExisting compares the control pass with the stored rows', () => {
  const stored = [row({ id: 'a' }), row({ id: 'b' })];
  const control = [row({ id: 'a', ...partial }), row({ id: 'b' })];
  const report = preExisting(stored, control);
  assert.deepEqual(report.worsened.map((r) => r.id), ['a']);
  assert.equal(report.unchanged, 1);
});

test('a slowdown needs both the factor and the seconds, with an unchanged status', () => {
  const timed = (time, status = 'AC') => row({ cases: [aCase({ time, status })] });
  const slowed = (from, to) => classify([timed(from)], [timed(to)]).slowdowns.length;
  assert.equal(slowed(1, 19), 1);
  assert.equal(slowed(1, 2), 1); // exactly x2 and exactly >= 0.2 s
  assert.equal(slowed(1, 1.99), 0); // below x2
  assert.equal(slowed(0.1, 0.29), 0); // x2.9 but under 0.2 s
  assert.equal(slowed(0.1, 0.3), 1); // x3 and 0.2 s
  assert.equal(slowed(2, 1), 0);
  assert.equal(classify([timed(1)], [timed(5, 'WA')]).slowdowns.length, 0);
  const lenient = classify([timed(1)], [timed(3)], { slowdownFactor: 4 });
  assert.equal(lenient.slowdowns.length, 0);
  const strict = classify([timed(1)], [timed(1.3)], { slowdownFactor: 1.2, slowdownSeconds: 0.3 });
  assert.equal(strict.slowdowns.length, 1);
});
