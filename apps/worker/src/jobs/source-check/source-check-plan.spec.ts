import { checkOf, compileCheckPlan, MAX_LOG_CHARS } from './source-check-plan';

const failure = (stage: string, kind: string, detail = '') => ({
  kind: 'failed' as const,
  failure: { stage, kind, program: 'checker', testIndex: 0, detail },
});

describe('compileCheckPlan', () => {
  it('compiles the upload alone, with no tests, in its role and language', () => {
    const plan = compileCheckPlan({ kind: 'customChecker', file: 'chk.cpp' });
    expect(plan?.tests).toEqual([]);
    expect(plan?.programs).toEqual([
      {
        name: 'checker',
        role: 'CHECKER',
        languageKey: 'CPP17',
        sourcePath: 'chk.cpp',
      },
    ]);
    expect(
      compileCheckPlan({ kind: 'customGrader', file: 'inter.cpp' })?.programs[0]
        .role,
    ).toBe('INTERACTOR');
    expect(
      compileCheckPlan({ kind: 'customChecker', file: 'chk.pas' })?.programs[0]
        .languageKey,
    ).toBe('PAS');
  });

  it('has no plan for a source the judge cannot compile', () => {
    expect(
      compileCheckPlan({ kind: 'customChecker', file: 'chk.py' }),
    ).toBeNull();
  });
});

describe('checkOf', () => {
  const now = new Date('2026-10-11T00:00:00Z');

  it('a finished compile is ok', () => {
    expect(checkOf({ kind: 'done' }, 'chk.cpp', now)).toEqual({
      file: 'chk.cpp',
      status: 'ok',
      log: '',
      checkedAt: now,
    });
  });

  it("a compile error is the teacher's, with the log cut to size", () => {
    const check = checkOf(
      failure('COMPILE', 'COMPILE_ERROR', 'x'.repeat(MAX_LOG_CHARS + 5)),
      'chk.cpp',
      now,
    );
    expect(check.status).toBe('error');
    expect(check.log).toHaveLength(MAX_LOG_CHARS);
  });

  it('anything else means no judge could check it, with the reason', () => {
    expect(
      checkOf(failure('JOB', 'INTERNAL', 'judge disconnected'), 'chk.cpp', now),
    ).toMatchObject({
      status: 'unavailable',
      log: 'JOB INTERNAL: judge disconnected',
    });
    for (const kind of ['timeout', 'no-judge', 'cancelled'] as const)
      expect(checkOf({ kind }, 'chk.cpp', now).status).toBe('unavailable');
  });
});
