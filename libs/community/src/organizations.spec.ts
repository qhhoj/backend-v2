import { organizationCodePrefix, organizationPoints } from './organizations';

describe('organizationPoints', () => {
  it('weighs members best first by 0.95^i', () => {
    expect(organizationPoints([50, 100])).toBeCloseTo(100 + 0.95 * 50, 9);
    expect(organizationPoints([100, 50, 10])).toBeCloseTo(
      100 + 47.5 + 9.025,
      9,
    );
  });

  it('ignores members without positive points', () => {
    expect(organizationPoints([0, -3, 20])).toBeCloseTo(20, 9);
    expect(organizationPoints([])).toBe(0);
  });

  it('counts only the top 100 members', () => {
    // 101 members of 1 point: the geometric sum of the first 100 weights.
    expect(organizationPoints(Array<number>(101).fill(1))).toBeCloseTo(
      (1 - 0.95 ** 100) / 0.05,
      9,
    );
  });
});

describe('organizationCodePrefix', () => {
  it.each([
    ['ctqh2429', 'ctqh2429_'],
    ['thpt-demo', 'thptdemo_'],
    ['THPT_Demo.2', 'thptdemo2_'],
  ])('%s gives %s', (slug, prefix) =>
    expect(organizationCodePrefix(slug)).toBe(prefix),
  );
});
