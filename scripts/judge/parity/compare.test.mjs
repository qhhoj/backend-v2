// scripts/judge/parity/compare.test.mjs — run: node --test scripts/judge/parity/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { differences } from './compare.mjs';

const run = (overrides = {}) => ({
  label: 'par_sum/PY3/ac',
  status: 'D',
  result: 'AC',
  casePoints: 100,
  caseTotal: 100,
  cases: [{ position: 1, status: 'AC', points: 30, total: 30, batch: null, feedback: '' }],
  ...overrides,
});

test('identical runs have no differences, time and memory are ignored', () => {
  assert.deepEqual(differences([run()], [run({ cases: [{ ...run().cases[0], time: 9, memory: 9 }] })]), []);
});

test('verdict, points and batch differences are reported per field', () => {
  const b = run({ result: 'WA', casePoints: 70, cases: [{ ...run().cases[0], status: 'WA', points: 0, batch: 1 }] });
  assert.deepEqual(differences([run()], [b]), [
    'par_sum/PY3/ac: result AC → WA',
    'par_sum/PY3/ac: casePoints 100 → 70',
    'par_sum/PY3/ac: case 1 status AC → WA',
    'par_sum/PY3/ac: case 1 points 30 → 0',
    'par_sum/PY3/ac: case 1 batch null → 1',
  ]);
});

test('a different case count and a missing run are differences', () => {
  assert.deepEqual(differences([run()], [run({ cases: [] })]), ['par_sum/PY3/ac: case count 1 → 0']);
  assert.deepEqual(differences([run()], []), ['par_sum/PY3/ac: missing on the right']);
  assert.deepEqual(differences([], [run()]), ['par_sum/PY3/ac: missing on the left']);
});

test('feedback is compared only for +feedback runs', () => {
  const label = 'par_identical/PY3/pe+feedback';
  const a = run({ label, cases: [{ ...run().cases[0], feedback: 'Presentation Error' }] });
  const b = run({ label, cases: [{ ...run().cases[0], feedback: '' }] });
  assert.equal(differences([a], [b]).length, 1);
  assert.deepEqual(differences([run({ cases: a.cases })], [run({ cases: b.cases })]), []);
});

test('points compare with a 1e-6 tolerance', () => {
  assert.deepEqual(differences([run({ casePoints: 33.3333333 })], [run({ casePoints: 33.3333334 })]), []);
});
