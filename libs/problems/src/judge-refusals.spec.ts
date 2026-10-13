import { judgeRefusal } from './judge-refusals';
import type { JudgedSettings } from './judge-refusals';

const plain = { type: 'C' as const, checker: '' as const, checkerArgs: null };
const base: JudgedSettings = {
  checker: 'floats',
  checkerArgs: { precision: 6 },
  grader: 'standard',
  nobigmath: false,
  cases: [plain, plain],
};
const withCases = (...cases: JudgedSettings['cases']): JudgedSettings => ({
  ...base,
  cases,
});

describe('judgeRefusal', () => {
  it('accepts cases graded with one checker, however they name it', () => {
    expect(judgeRefusal(base)).toBeNull();
    const floats6 = { ...plain, checker: 'floats' as const };
    expect(
      judgeRefusal(withCases({ ...floats6, checkerArgs: { precision: 6 } })),
    ).toBeNull();
    const standard = { ...plain, checker: 'standard' as const };
    expect(judgeRefusal(withCases(standard, standard))).toBeNull();
  });

  it('refuses nobigmath, which the judge does not grade', () => {
    const refusal = judgeRefusal({ ...base, nobigmath: true });
    expect(refusal?.field).toBe('nobigmath');
    expect(refusal?.message).toMatch(/nobigmath/);
  });

  it('refuses cases graded with different checkers or arguments', () => {
    const standard = { ...plain, checker: 'standard' as const };
    const refusal = judgeRefusal(withCases(plain, standard));
    expect(refusal?.field).toBe('cases.1.checker');
    expect(refusal?.message).toMatch(/Case #2/);
    const floats9 = {
      ...plain,
      checker: 'floats' as const,
      checkerArgs: { precision: 9 },
    };
    expect(judgeRefusal(withCases(plain, floats9))?.field).toBe(
      'cases.1.checker',
    );
  });

  it("grades a batch's cases with the batch start's checker", () => {
    const start = {
      ...plain,
      type: 'S' as const,
      checker: 'standard' as const,
    };
    const end = { ...plain, type: 'E' as const };
    expect(judgeRefusal(withCases(start, plain, end, plain))?.field).toBe(
      'cases.3.checker',
    );
    expect(judgeRefusal(withCases(start, plain, end))).toBeNull();
  });

  it('ignores case checkers on interactive problems, whose interactor grades', () => {
    const standard = { ...plain, checker: 'standard' as const };
    expect(
      judgeRefusal({ ...withCases(plain, standard), grader: 'interactive' }),
    ).toBeNull();
  });
});
