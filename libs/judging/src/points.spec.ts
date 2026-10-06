import { acceptanceRate, userPoints } from './points';
import type { ProblemBest } from './points';

const best = (maxPoints: number, solved = false): ProblemBest => ({
  maxPoints,
  solved,
});

describe('userPoints (legacy calculate_points)', () => {
  it('is all zero without submissions', () =>
    expect(userPoints([])).toEqual({
      points: 0,
      performancePoints: 0,
      problemCount: 0,
    }));

  it('weighs bests from the largest down and adds 0.05 per solved problem', () => {
    const result = userPoints([best(200), best(1000, true)]);
    expect(result.points).toBe(1200);
    expect(result.problemCount).toBe(1);
    expect(result.performancePoints).toBeCloseTo(
      1000 + 0.98514 * 200 + 0.05,
      9,
    );
  });

  it('does not depend on the order the problems arrive in', () => {
    const shuffled = userPoints([best(10), best(30), best(20)]);
    expect(shuffled.performancePoints).toBeCloseTo(
      30 + 0.98514 * 20 + 0.98514 ** 2 * 10,
      9,
    );
    expect(userPoints([best(30), best(20), best(10)])).toEqual(shuffled);
  });

  it('counts every best in points but only the first 300 in performance points', () => {
    const bests = Array.from({ length: 301 }, () => best(800, true));
    const result = userPoints(bests);
    expect(result.points).toBe(301 * 800);
    expect(result.problemCount).toBe(301);
    const geometric = (1 - 0.98514 ** 300) / (1 - 0.98514);
    expect(result.performancePoints).toBeCloseTo(
      800 * geometric + 0.05 * 301,
      6,
    );
  });

  it('leaves zero-point bests out of the weighting but still counts a solved one', () => {
    const result = userPoints([best(0, true), best(0), best(500)]);
    expect(result).toEqual({
      points: 500,
      performancePoints: 500 + 0.05,
      problemCount: 1,
    });
  });

  it('never exceeds points plus the bonus; a smaller extra best counts only within the first 300', () => {
    for (let count = 1; count <= 400; count += 37) {
      const bests = Array.from({ length: count }, (_unused, index) =>
        best(800 + index, index % 2 === 0),
      );
      const result = userPoints(bests);
      expect(result.performancePoints).toBeLessThanOrEqual(
        result.points + 0.05 * result.problemCount,
      );
      const extended = userPoints([...bests, best(1)]).performancePoints;
      if (count < 300)
        expect(extended).toBeGreaterThan(result.performancePoints);
      else expect(extended).toBe(result.performancePoints);
    }
  });
});

describe('acceptanceRate (legacy update_stats)', () => {
  it('is zero without submissions', () => expect(acceptanceRate(0, 0)).toBe(0));
  it('is the percentage of accepted submissions', () => {
    expect(acceptanceRate(3, 5)).toBe(60);
    expect(acceptanceRate(1, 3)).toBeCloseTo(33.3333333, 6);
    expect(acceptanceRate(4, 4)).toBe(100);
  });
});
