import {
  CUSTOM_CHECKER_TYPES,
  EMPTY_TEST_CASE,
  emptyProblemData,
} from '@libs/database';
import { compileInitYaml } from '@libs/problems';
import { buildProblemXml } from '../../../test/polygon-fixtures';
import { parseAssets } from './polygon-assets';
import { PolygonImportError } from './polygon-import.error';
import { parseXml } from '@libs/problems';

const assets = (fixture: Parameters<typeof buildProblemXml>[0]) =>
  parseAssets(parseXml(buildProblemXml(fixture)));
const oneTest = { tests: [{ input: '1', answer: '1' }] };

const bridged = (
  polygonChecker: string,
  checkerArgs = { type: 'testlib', lang: 'CPP17' },
) => ({
  grader: 'standard',
  checker: 'bridged',
  checkerArgs,
  checkerSource: 'files/check.cpp',
  polygonChecker,
  interactorSource: null,
  graderArgs: null,
});

describe('parseAssets', () => {
  it.each([
    'std::wcmp.cpp',
    'std::ncmp.cpp',
    'std::lcmp.cpp',
    'std::fcmp.cpp',
    'std::rcmp4.cpp',
    'std::rcmp6.cpp',
    'std::rcmp9.cpp',
    'std::yesno.cpp',
  ])('runs %s from the package source as a bridged testlib checker', (name) =>
    expect(
      assets({ ...oneTest, checker: { name, path: 'files/check.cpp' } }),
    ).toEqual(bridged(name)),
  );

  it('maps std::hcmp.cpp to the standard checker', () =>
    expect(
      assets({
        ...oneTest,
        checker: { name: 'std::hcmp.cpp', path: 'files/check.cpp' },
      }),
    ).toEqual({
      grader: 'standard',
      checker: 'standard',
      checkerArgs: null,
      checkerSource: null,
      polygonChecker: 'std::hcmp.cpp',
      interactorSource: null,
      graderArgs: null,
    }));

  it('uses a custom C++ checker as bridged testlib, honouring percent points', () => {
    expect(
      assets({ ...oneTest, checker: { path: 'files/check.cpp' } }),
    ).toEqual(bridged('files/check.cpp'));
    expect(
      assets({
        ...oneTest,
        checker: { name: 'std::ncmp.cpp', path: 'files/check.cpp' },
        judging: { percent: true },
      }).checkerArgs,
    ).toEqual({
      type: 'testlib',
      lang: 'CPP17',
      treat_checker_points_as_percentage: true,
    });
    expect(() =>
      assets({ ...oneTest, checker: { path: 'files/check.py' } }),
    ).toThrow(new PolygonImportError('checker must use C++'));
    expect(() => assets({ ...oneTest, checker: null })).toThrow(
      new PolygonImportError('checker not found'),
    );
  });

  it('keeps the checker of an interactive problem beside its interactor', () => {
    const withInteractor = (checker: { name?: string; path: string } | null) =>
      assets({ ...oneTest, interactor: 'files/interactor.cpp', checker });
    expect(
      withInteractor({ name: 'std::wcmp.cpp', path: 'files/check.cpp' }),
    ).toEqual({
      ...bridged('std::wcmp.cpp'),
      grader: 'interactive',
      interactorSource: 'files/interactor.cpp',
    });
    expect(
      withInteractor({ name: 'std::hcmp.cpp', path: 'files/check.cpp' }),
    ).toMatchObject({ grader: 'interactive', checker: 'standard' });
    expect(() => withInteractor({ path: 'files/Check.java' })).toThrow(
      new PolygonImportError('checker must use C++'),
    );
    expect(() => withInteractor(null)).toThrow(
      new PolygonImportError('checker not found'),
    );
    expect(() =>
      assets({ ...oneTest, interactor: 'files/interactor.java' }),
    ).toThrow(new PolygonImportError('interactor must use C++'));
  });

  it("reads the interactor's points as a percentage when the package does, whatever the checker", () => {
    const interactive = (name: string, percent: boolean) =>
      assets({
        ...oneTest,
        interactor: 'files/interactor.cpp',
        checker: { name, path: 'files/check.cpp' },
        judging: { percent },
      }).graderArgs;
    const percentArgs = { treat_checker_points_as_percentage: true };
    expect(interactive('std::wcmp.cpp', true)).toEqual(percentArgs);
    expect(interactive('std::hcmp.cpp', true)).toEqual(percentArgs);
    expect(interactive('std::wcmp.cpp', false)).toBeNull();
    expect(
      assets({
        ...oneTest,
        checker: { path: 'files/check.cpp' },
        judging: { percent: true },
      }).graderArgs,
    ).toBeNull();
  });

  it('produces a custom checker the init.yml compiler accepts, with a type from the known list', () => {
    const parsed = assets({ ...oneTest, checker: { path: 'files/check.cpp' } });
    expect(CUSTOM_CHECKER_TYPES).toContain(parsed.checkerArgs?.type);
    const compiled = compileInitYaml(
      {
        ...emptyProblemData(),
        checker: parsed.checker,
        checkerArgs: parsed.checkerArgs,
        customChecker: 'checker.cpp',
        cases: [
          { ...EMPTY_TEST_CASE, input: '01.inp', output: '01.out', points: 1 },
        ],
      },
      new Set(['01.inp', '01.out']),
    );
    expect(compiled.yaml).toContain('checker.cpp');
    expect(compiled.yaml).toContain('testlib');
  });

  const refusalOf = (
    fixture: Parameters<typeof buildProblemXml>[0],
  ): unknown => {
    try {
      assets(fixture);
    } catch (error: unknown) {
      return error;
    }
    throw new Error('the package was accepted');
  };

  it('imports a package that runs the solution once, or does not say', () => {
    for (const runCount of [undefined, '1', ' 1 ']) {
      expect(assets({ ...oneTest, judging: { runCount } }).grader).toBe(
        'standard',
      );
      expect(
        assets({
          ...oneTest,
          interactor: 'files/interactor.cpp',
          judging: { runCount },
        }).grader,
      ).toBe('interactive');
    }
  });

  it.each(['2', '3', '0', '01', 'two', ''])(
    'refuses run-count %j, with or without an interactor, naming the count',
    (runCount) => {
      for (const interactor of [null, 'files/interactor.cpp']) {
        const refusal = refusalOf({
          ...oneTest,
          interactor,
          judging: { runCount },
        });
        expect(refusal).toBeInstanceOf(PolygonImportError);
        expect(refusal).toMatchObject({
          code: 'polygon_run_count_unsupported',
          params: { runCount },
        });
      }
    },
  );

  it('refuses the run count before looking at the checker', () => {
    expect(
      refusalOf({ ...oneTest, checker: null, judging: { runCount: '2' } }),
    ).toMatchObject({ code: 'polygon_run_count_unsupported' });
  });
});
