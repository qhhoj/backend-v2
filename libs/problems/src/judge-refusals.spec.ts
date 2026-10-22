import { JUDGE_MAX_OUTPUT_LIMIT, judgeRefusal } from './judge-refusals';
import type { JudgedSettings } from './judge-refusals';

const plain = {
  type: 'C' as const,
  checker: '' as const,
  checkerArgs: null,
  outputLimit: null,
};
const base: JudgedSettings = {
  checker: 'floats',
  checkerArgs: { precision: 6 },
  grader: 'standard',
  generator: null,
  nobigmath: false,
  outputLimit: null,
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

  it('refuses a generator, which the judge does not run', () => {
    const refusal = judgeRefusal({ ...base, generator: 'gen.cpp' });
    expect(refusal?.field).toBe('generator');
    expect(refusal?.message).toMatch(/generator/);
  });

  it('refuses an output limit above 64 MiB, problem-wide or on any row', () => {
    const tooLarge = JUDGE_MAX_OUTPUT_LIMIT + 1;
    expect(JUDGE_MAX_OUTPUT_LIMIT).toBe(64 * 1024 * 1024);
    expect(judgeRefusal({ ...base, outputLimit: tooLarge })?.field).toBe(
      'outputLimit',
    );
    const start = { ...plain, type: 'S' as const, outputLimit: tooLarge };
    expect(judgeRefusal(withCases(plain, start, plain))?.message).toMatch(
      /Case #2/,
    );
    expect(
      judgeRefusal(withCases(plain, { ...plain, outputLimit: tooLarge }))
        ?.field,
    ).toBe('cases.1.outputLimit');
  });

  it('accepts an output limit of exactly 64 MiB', () => {
    const limit = JUDGE_MAX_OUTPUT_LIMIT;
    expect(
      judgeRefusal({
        ...withCases({ ...plain, outputLimit: limit }),
        outputLimit: limit,
      }),
    ).toBeNull();
  });
});
