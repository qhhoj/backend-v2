import type { GradableCase } from './scoring';
import { gradeCases, pythonRound, submissionPoints } from './scoring';

const plain = (
  points: number,
  total: number,
  extra: Partial<GradableCase> = {},
): GradableCase => ({
  status: 'AC',
  time: 0,
  memory: 0,
  points,
  total,
  batch: null,
  ...extra,
});

describe('pythonRound', () => {
  it.each([
    [0.125, 2, 0.12],
    [0.375, 2, 0.38],
    [2.5, 0, 2],
    [3.5, 0, 4],
    [0.25, 1, 0.2],
    [0.75, 1, 0.8],
    [-2.5, 0, -2],
    [-0.125, 2, -0.12],
    [389493309600665.875, 2, 389493309600665.9],
  ])('rounds the exact tie %p to even at %p digits', (value, digits, rounded) =>
    expect(pythonRound(value, digits)).toBe(rounded),
  );
  it.each([
    [2.675, 2, 2.67],
    [1.06, 1, 1.1],
    [33.33333, 3, 33.333],
    [7, 1, 7],
    [2.5e50, 3, 2.5e50],
  ])('rounds %p to the nearest at %p digits', (value, digits, rounded) =>
    expect(pythonRound(value, digits)).toBe(rounded),
  );
});

describe('gradeCases', () => {
  it('takes the largest time and memory and the worst status in legacy order', () => {
    const totals = gradeCases([
      plain(1, 1, { time: 0.5, memory: 100 }),
      plain(0, 1, { status: 'WA', time: 0.2, memory: 300 }),
      plain(0, 1, { status: 'TLE', time: 1, memory: 50 }),
    ]);
    expect(totals).toMatchObject({ time: 1, memory: 300, result: 'TLE' });
    expect(
      gradeCases([
        plain(0, 1, { status: 'MLE' }),
        plain(0, 1, { status: 'TLE' }),
      ]).result,
    ).toBe('TLE');
    expect(
      gradeCases([
        plain(0, 1, { status: 'OLE' }),
        plain(0, 1, { status: 'RTE' }),
      ]).result,
    ).toBe('OLE');
    expect(
      gradeCases([plain(0, 1, { status: 'SC' }), plain(1, 1)]).result,
    ).toBe('AC');
  });
  it('adds plain cases and, per batch, the smallest points and the largest total', () => {
    const totals = gradeCases([
      plain(1, 1),
      plain(0, 1, { status: 'WA' }),
      plain(2, 3, { batch: 1 }),
      plain(3, 3, { batch: 1 }),
      plain(0, 2, { batch: 2, status: 'WA' }),
      plain(2, 2, { batch: 2 }),
    ]);
    expect(totals).toMatchObject({ casePoints: 3, caseTotal: 7, result: 'WA' });
  });
  it('rounds the sums to one decimal like Python', () =>
    expect(gradeCases([plain(0.25, 0.75)])).toMatchObject({
      casePoints: 0.2,
      caseTotal: 0.8,
    }));
  it('keeps a near miss a tenth below the total instead of rounding it up to full', () => {
    const nineFull = Array.from({ length: 9 }, () => plain(1, 1));
    expect(gradeCases([...nineFull, plain(0.96, 1)])).toMatchObject({
      result: 'AC',
      casePoints: 9.9,
      caseTotal: 10,
    });
    expect(
      gradeCases([...nineFull, plain(0.96, 1, { status: 'WA' })]),
    ).toMatchObject({ result: 'WA', casePoints: 9.9, caseTotal: 10 });
  });
  it('keeps a near miss below a fractional total that rounds down', () =>
    expect(gradeCases([plain(9.91, 9.92)])).toMatchObject({
      casePoints: 9.8,
      caseTotal: 9.9,
    }));
  it('gives full marks to every point earned despite float noise or a fractional total', () => {
    const tenths = Array.from({ length: 100 }, () => plain(0.1, 0.1));
    expect(gradeCases(tenths)).toMatchObject({ casePoints: 10, caseTotal: 10 });
    expect(gradeCases([plain(9.96, 9.96)])).toMatchObject({
      casePoints: 10,
      caseTotal: 10,
    });
  });
  it('grades a submission without cases as SC with nothing earned (legacy)', () =>
    expect(gradeCases([])).toEqual({
      time: 0,
      memory: 0,
      result: 'SC',
      casePoints: 0,
      caseTotal: 0,
    }));
  it('never earns more than the total when every case earns at most its own', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const cases = Array.from({ length: (seed % 7) + 1 }, (_unused, index) => {
        const total = ((seed * (index + 3)) % 10) + 1;
        return plain((seed * (index + 1)) % (total + 1), total, {
          batch: index % 3 === 0 ? null : (index % 2) + 1,
        });
      });
      const { casePoints, caseTotal } = gradeCases(cases);
      expect(casePoints).toBeGreaterThanOrEqual(0);
      expect(casePoints).toBeLessThanOrEqual(caseTotal);
    }
  });
  it('reaches the total exactly when every point was earned, for fractional points too', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const cases = Array.from({ length: (seed % 9) + 1 }, (_unused, index) => {
        const batch = index % 3 === 0 ? null : (index % 2) + 1;
        // Cases of one batch share a total, so earning each case's total earns the batch's.
        const total = (((seed * ((batch ?? index + 2) + 7)) % 97) + 1) / 7;
        const earned = (seed * (index + 1)) % 11 === 0 ? 0.999 : 1;
        return plain(total * earned, total, { batch });
      });
      const everyPoint = cases.every(({ points, total }) => points === total);
      const { casePoints, caseTotal } = gradeCases(cases);
      expect(casePoints >= caseTotal).toBe(everyPoint);
    }
  });
});

describe('submissionPoints', () => {
  it('scales partial results to the problem points, rounded to 3 decimals', () =>
    expect(submissionPoints(1, 3, 100, true)).toBe(33.333));
  it('keeps a full non-partial result and zeroes anything less', () => {
    expect(submissionPoints(7, 7, 100, false)).toBe(100);
    expect(submissionPoints(6.9, 7, 100, false)).toBe(0);
  });
  it('zeroes a non-partial result that only rounds to full marks', () =>
    expect(submissionPoints(999.9, 1000, 1, false)).toBe(0));
  it('scores a near miss of 10 one-point cases below full marks', () => {
    const nineFull = Array.from({ length: 9 }, () => plain(1, 1));
    const { casePoints, caseTotal } = gradeCases([...nineFull, plain(0.96, 1)]);
    expect(submissionPoints(casePoints, caseTotal, 1500, false)).toBe(0);
    expect(submissionPoints(casePoints, caseTotal, 1500, true)).toBe(1485);
  });
  it('is zero without any total', () => {
    expect(submissionPoints(0, 0, 100, true)).toBe(0);
    expect(submissionPoints(0, 0, 100, false)).toBe(0);
  });
  it('stays between zero and the problem points for earned ≤ total', () => {
    for (let earned = 0; earned <= 40; earned += 1)
      for (const partial of [true, false]) {
        const points = submissionPoints(earned / 4, 10, 1700, partial);
        expect(points).toBeGreaterThanOrEqual(0);
        expect(points).toBeLessThanOrEqual(1700);
      }
  });
});
