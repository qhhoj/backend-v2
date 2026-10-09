import { countDataShapes } from './legacy-data-shapes';

describe('countDataShapes', () => {
  it('counts bridged checkers by extension and lists the ones judge-v2 has no testlib for', async () => {
    const counts = await countDataShapes([
      {
        code: 'a',
        data: { checker: 'bridged', customChecker: 'chk.cpp', cases: [] },
      },
      {
        code: 'b',
        data: { checker: 'bridged', customChecker: 'Check.PAS', cases: [] },
      },
      {
        code: 'c',
        data: { checker: 'bridged', customChecker: 'Checker.java', cases: [] },
      },
      {
        code: 'd',
        data: { checker: 'standard', customChecker: 'old.pas', cases: [] },
      },
    ]);
    expect(counts.bridged).toEqual({ cpp: 1, pas: 1, java: 1 });
    expect(counts.bridgedNeedingTestlib).toEqual(['b', 'c']);
  });

  it('lists problems whose case files sit in an archive subdirectory, once each', async () => {
    const counts = await countDataShapes([
      { code: 'flat', data: { cases: [{ input: '1.in', output: '1.out' }] } },
      {
        code: 'nested',
        data: {
          cases: [
            { input: 'tests/1.in', output: 'tests/1.out' },
            { input: 'tests/2.in', output: 'tests/2.out' },
          ],
        },
      },
      {
        code: 'out_only',
        data: { cases: [{ input: '1.in', output: 'ans/1.out' }] },
      },
    ]);
    expect(counts.nestedCaseNames).toEqual(['nested', 'out_only']);
  });

  it('accepts problems without data or cases', async () => {
    const counts = await countDataShapes([
      { code: 'empty', data: null },
      { code: 'bare', data: {} },
    ]);
    expect(counts).toEqual({
      bridged: {},
      bridgedNeedingTestlib: [],
      nestedCaseNames: [],
    });
  });
});
