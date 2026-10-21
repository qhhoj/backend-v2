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

const bridged = (checkerArgs = { type: 'testlib', lang: 'CPP17' }) => ({
  grader: 'standard',
  checker: 'bridged',
  checkerArgs,
  checkerSource: 'files/check.cpp',
  interactorSource: null,
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
    ).toEqual(bridged()),
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
      interactorSource: null,
    }));

  it('uses a custom C++ checker as bridged testlib, honouring percent points', () => {
    expect(
      assets({ ...oneTest, checker: { path: 'files/check.cpp' } }),
    ).toEqual(bridged());
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

  it('prefers the interactor: interactive grader, checker ignored', () => {
    const interactive = {
      grader: 'interactive',
      checker: 'standard',
      checkerArgs: null,
      checkerSource: null,
      interactorSource: 'files/interactor.cpp',
    };
    expect(
      assets({
        ...oneTest,
        interactor: 'files/interactor.cpp',
        checker: { name: 'std::wcmp.cpp', path: 'files/check.cpp' },
      }),
    ).toEqual(interactive);
    expect(
      assets({
        ...oneTest,
        interactor: 'files/interactor.cpp',
        checker: { path: 'files/Check.java' },
      }),
    ).toEqual(interactive);
    expect(
      assets({ ...oneTest, interactor: 'files/interactor.cpp', checker: null }),
    ).toEqual(interactive);
    expect(() =>
      assets({ ...oneTest, interactor: 'files/interactor.java' }),
    ).toThrow(new PolygonImportError('interactor must use C++'));
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
});
